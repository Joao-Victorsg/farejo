import {
  CircuitBreakerError,
  NotFoundError,
  RetryableError,
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
const WEBFONES_SLUG = "webfones";
const DELAY_BASE_MS = 1300;
// Backoff do soft-block, não exponencial (8, 16, 24s) — 3 retries antes de desistir do slug.
const SOFT_BLOCK_BACKOFFS_MS = [8000, 16000, 24000];
const CIRCUIT_BREAKER_THRESHOLD = 12;
const DirectorySlug = z.string().min(1).regex(/^[^/?#\s]+$/u);
const PAGE_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  Referer: `${BASE}/desconto`,
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Upgrade-Insecure-Requests": "1",
};

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
  const canonical = $("link[rel='canonical']").attr("href");
  if (canonical && new URL(canonical, BASE).pathname.startsWith("/cupom/")) return { slug, outcome: "not_found" };
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
  reportSoftBlock?: (slug: string, detail: string) => void;
}

function softBlockDetail(html: string): string {
  const $ = cheerio.load(html);
  return `title=${JSON.stringify($("title").first().text().trim())} canonical=${JSON.stringify($("link[rel='canonical']").attr("href") ?? null)} h1=${JSON.stringify($("h1").first().text().trim())}`;
}

interface CuponomiaPageFetchDeps {
  fetchNormally: (url: string, headers: Record<string, string>) => Promise<string>;
  fetchWithChromium: (url: string, slug: string) => Promise<string>;
}

function hasValidStoreHeader(html: string, slug: string): boolean {
  const $ = cheerio.load(html);
  const header = $(".store_header").first();
  return header.length > 0 && header.attr("data-store-slug")?.trim() === slug;
}

/**
 * O fallback é deliberadamente estreito: só Webfones, só depois de `fetchText`
 * esgotar seus retries e devolver o 405 observado no Actions. Nenhuma outra falha
 * de rede, 404 ou slug abre Chromium. O HTML do browser só é aceito se provar a
 * presença da rota pedida pelo próprio `data-store-slug`.
 */
export async function fetchCuponomiaPageWithFallback(
  slug: string,
  deps: CuponomiaPageFetchDeps,
): Promise<string> {
  const url = `${BASE}/desconto/${slug}`;
  try {
    return await deps.fetchNormally(url, PAGE_HEADERS);
  } catch (error) {
    const exhaustedWebfones405 =
      slug === WEBFONES_SLUG &&
      error instanceof RetryableError &&
      error.message === `HTTP 405 em ${url}`;
    if (!exhaustedWebfones405) throw error;

    const html = await deps.fetchWithChromium(url, slug);
    if (!hasValidStoreHeader(html, slug)) {
      throw new RetryableError(`Chromium sem .store_header válido para ${slug}`);
    }
    return html;
  }
}

async function fetchWebfonesWithChromium(url: string, slug: string): Promise<string> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      locale: "pt-BR",
      extraHTTPHeaders: { "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" },
    });
    const page = await context.newPage();
    const response = await page.goto(url, {
      referer: `${BASE}/desconto`,
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (response?.status() === 404) throw new NotFoundError(`HTTP 404 em ${url}`);

    await page.locator(".store_header").first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => undefined);

    const finalUrl = new URL(page.url());
    const expectedPath = `/desconto/${slug}`;
    if (finalUrl.origin !== BASE || finalUrl.pathname.replace(/\/+$/u, "") !== expectedPath) {
      throw new RetryableError(`Chromium redirecionou ${slug} para URL inesperada: ${finalUrl.origin}${finalUrl.pathname}`);
    }
    return await page.content();
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof RetryableError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new RetryableError(`Falha no Chromium para ${slug}: ${reason}`);
  } finally {
    await browser.close();
  }
}

/** Um slug, com retry por backoff fixo enquanto o desfecho for `soft_block`. */
async function scrapeSlugWithBackoff(slug: string, deps: CuponomiaScrapeDeps): Promise<SlugOutcome> {
  let last: SlugOutcome = { slug, outcome: "soft_block" };
  for (let attempt = 0; attempt <= SOFT_BLOCK_BACKOFFS_MS.length; attempt++) {
    let outcome: SlugOutcome;
    try {
      const html = await deps.fetchPage(slug);
      outcome = parseCuponomiaStorePage(html, slug);
      if (outcome.outcome === "soft_block") deps.reportSoftBlock?.(slug, softBlockDetail(html));
    } catch (error) {
      if (error instanceof NotFoundError) return { slug, outcome: "not_found" };
      if (!(error instanceof RetryableError)) throw error;
      deps.reportSoftBlock?.(slug, error.message);
      outcome = { slug, outcome: "soft_block" };
    }
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
        fetchCuponomiaPageWithFallback(slug, {
          fetchNormally: fetchText,
          fetchWithChromium: fetchWebfonesWithChromium,
        }),
      sleep: realSleep,
      reportSoftBlock: (slug, detail) => console.warn(`[cuponomia] soft_block ${slug}: ${detail}`),
    });
  },
};
