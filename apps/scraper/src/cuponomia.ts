import {
  CircuitBreakerError,
  type PlatformAdapter,
  type RawOffer,
  type ScrapeInstruction,
  type ScrapeResult,
  type SlugOutcome,
} from "@farejo/shared";
import * as cheerio from "cheerio";
import { z } from "zod";
import { fetchText } from "./http.js";

const BASE = "https://www.cuponomia.com.br";
const DELAY_BASE_MS = 1300;
// Backoff do soft-block, não exponencial (8, 16, 24s) — 3 retries antes de desistir do slug.
const SOFT_BLOCK_BACKOFFS_MS = [8000, 16000, 24000];
const CIRCUIT_BREAKER_THRESHOLD = 12;
const DirectorySlug = z.string().min(1).regex(/^[^/?#\s]+$/u);

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Diretório público usado só para semear o universo da coleta tiered, nunca valores de cashback. */
export function parseCuponomiaDirectory(html: string): string[] {
  const $ = cheerio.load(html);
  const slugs = new Set<string>();

  $("ul.list-letter a[href^='/desconto/']").each((_, element) => {
    const href = ($(element).attr("href") ?? "").split("?")[0] ?? "";
    const slug = href.replace("/desconto/", "").trim();
    if (!slug) throw new Error("cuponomia: diretório contém link de loja sem slug");
    slugs.add(DirectorySlug.parse(slug));
  });

  return [...slugs];
}

/**
 * `data-cashback-displayed` não é só "2%": quando `up-to`, vem **"até 4%"** — sem tirar
 * o prefixo antes de qualquer parse numérico downstream, dá NaN. `bare` já vem sem o
 * prefixo, pronto pro fallback de `rewardText` sem duplicar "até".
 */
function parseDisplayed(displayed: string): { hasCashback: boolean; upTo: boolean; bare: string } {
  const upTo = /^at[eé]\s+/i.test(displayed);
  const bare = displayed.replace(/^at[eé]\s+/i, "").trim();
  return { hasCashback: /\d/.test(bare), upTo, bare };
}

/**
 * Parse puro: HTML de página de loja do cuponomia → desfecho do slug. Sem I/O.
 *
 * Ausência de `.store_header` (soft-404: HTTP 200 servindo a home) é `soft_block`,
 * nunca "sem cashback" — quem chama decide se retenta.
 *
 * ⚠️ Boost NÃO se lê com regex sobre o texto do header (o `.store_header` embute um
 * `<style>` inline; `era 5%` numa regra CSS vira falso positivo). Sinal = elemento
 * `del.rewardsTag-previous` + classe `has-store-boost-cashback` no aside.
 *
 * ⚠️ Nem toda loja com cashback tem `aside.rewardsTag` — ausência só implica `upTo=false`.
 */
export function parseCuponomiaStorePage(html: string, slug: string): SlugOutcome {
  const $ = cheerio.load(html);
  const header = $(".store_header").first();
  if (header.length === 0) return { slug, outcome: "soft_block" };

  const name = header.attr("data-store-name")?.trim();
  if (!name) return { slug, outcome: "soft_block" };

  const displayed = header.attr("data-cashback-displayed")?.trim() ?? "";
  const actual = header.attr("data-store-cashback-actual")?.trim() ?? "";
  const { hasCashback, upTo: upToFromText, bare } = parseDisplayed(displayed);
  if (!hasCashback) return { slug, outcome: "no_cashback" };

  // `del` sempre escopado DENTRO do `tag` casado — a página tem 2 widgets rewards-tag
  // (desktop + mobile) com o mesmo conteúdo; buscar os dois independentemente do header
  // arrisca parear o `tag` de um com o `del` do outro se um dia divergirem.
  const tag = header.find("[data-test-id='rewards-tag'], aside.rewardsTag").first();
  const del = tag.find("del.rewardsTag-previous").first();
  const boost = del.length > 0 && /has-store-boost-cashback/.test(tag.attr("class") ?? "");
  const upTo = tag.attr("data-should-use-up-to") === "true" || upToFromText;

  const offer: RawOffer = {
    storeName: name,
    rewardText: actual || `${upTo ? "até " : ""}${bare} de cashback`,
    previousRewardText: boost ? del.text().trim().replace(/^\(|\)$/g, "") : undefined,
    url: `${BASE}/desconto/${slug}`,
    logoUrl: header.find("img").first().attr("src") || undefined,
  };
  return { slug, outcome: "offer", offer };
}

interface CuponomiaScrapeDeps {
  fetchPage: (slug: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
}

/** Um slug, com retry por backoff fixo enquanto o desfecho for `soft_block`. */
async function scrapeSlugWithBackoff(slug: string, deps: CuponomiaScrapeDeps): Promise<SlugOutcome> {
  let last: SlugOutcome = { slug, outcome: "soft_block" };
  for (let attempt = 0; attempt <= SOFT_BLOCK_BACKOFFS_MS.length; attempt++) {
    const html = await deps.fetchPage(slug);
    const outcome = parseCuponomiaStorePage(html, slug);
    if (outcome.outcome !== "soft_block") return outcome;
    last = outcome;
    if (attempt < SOFT_BLOCK_BACKOFFS_MS.length) await deps.sleep(SOFT_BLOCK_BACKOFFS_MS[attempt]!);
  }
  return last;
}

/**
 * Orquestra a coleta tiered por slugs (ADR-0005): consome só `instruction.target.slugs`,
 * nunca visita o diretório inteiro. Circuit breaker conta soft-blocks CONSECUTIVOS —
 * um outcome que não é soft-block zera o contador (ADR-0005 decisão 1).
 */
export async function scrapeCuponomiaSlugs(
  instruction: ScrapeInstruction,
  deps: CuponomiaScrapeDeps,
): Promise<ScrapeResult> {
  if (instruction.target.kind !== "slugs") {
    throw new Error("cuponomia: scrape requer instruction.target.kind === 'slugs'");
  }
  const slugs = instruction.target.slugs;
  const delayMs = DELAY_BASE_MS * instruction.throttleMultiplier;

  const outcomes: SlugOutcome[] = [];
  const offers: RawOffer[] = [];
  let consecutiveSoftBlocks = 0;
  let softBlocksTotal = 0;

  for (let i = 0; i < slugs.length; i++) {
    const outcome = await scrapeSlugWithBackoff(slugs[i]!, deps);
    outcomes.push(outcome);
    if (outcome.outcome === "offer") offers.push(outcome.offer);

    if (outcome.outcome === "soft_block") {
      consecutiveSoftBlocks++;
      softBlocksTotal++;
      if (consecutiveSoftBlocks >= CIRCUIT_BREAKER_THRESHOLD) {
        throw new CircuitBreakerError(`cuponomia: ${CIRCUIT_BREAKER_THRESHOLD} soft-blocks consecutivos`, {
          softBlocksSoFar: softBlocksTotal,
          rawCountSoFar: outcomes.length,
        });
      }
    } else {
      consecutiveSoftBlocks = 0;
    }

    if (i < slugs.length - 1) await deps.sleep(delayMs);
  }

  return {
    offers,
    scope: { kind: "partial", slugs: new Set(slugs) },
    rawCount: outcomes.length,
    softBlocks: softBlocksTotal,
    outcomes,
  };
}

export const cuponomiaAdapter: PlatformAdapter = {
  platformId: "cuponomia",
  async scrape(instruction: ScrapeInstruction) {
    return scrapeCuponomiaSlugs(instruction, {
      fetchPage: (slug) =>
        fetchText(`${BASE}/desconto/${slug}`, {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        }),
      sleep: realSleep,
    });
  },
};
