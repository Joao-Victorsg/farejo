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
import { fetchTextResponse } from "./http.js";

const BASE = "https://www.meliuz.com.br";
const DELAY_BASE_MS = 1500;
// Méliuz não confirmou soft-block ao vivo (CLAUDE.md: "por precaução") — reusa o mesmo
// backoff do cuponomia até haver sinal real que justifique números próprios.
const SOFT_BLOCK_BACKOFFS_MS = [8000, 16000, 24000];
const CIRCUIT_BREAKER_THRESHOLD = 12;
const DirectorySlug = z.string().min(1).regex(/^[^/?#\s]+$/u);

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Redirect para o diretório prova que a rota de loja não existe mais; não é soft-block. */
export function isMeliuzDirectoryRedirect(finalUrl: string): boolean {
  const url = new URL(finalUrl);
  return url.origin === BASE && url.pathname.replace(/\/+$/u, "") === "/desconto";
}

/** Diretório público usado só para semear o universo da coleta tiered, nunca valores de cashback. */
export function parseMeliuzDirectory(html: string): string[] {
  const $ = cheerio.load(html);
  const slugs = new Set<string>();

  $("a[href^='/desconto/']").each((_, element) => {
    const href = ($(element).attr("href") ?? "").split("?")[0] ?? "";
    const slug = href.replace("/desconto/", "").trim();
    if (!slug) throw new Error("meliuz: diretório contém link de loja sem slug");
    slugs.add(DirectorySlug.parse(slug));
  });

  return [...slugs];
}

// ld+json é dado externo (embutido pelo méliuz na página) — valida com zod antes de
// virar tipo do domínio, nunca `as` (farejo-typescript §1/§5).
const LdJsonStore = z.object({
  "@type": z.literal("Store"),
  name: z.string(),
  image: z.union([z.string(), z.object({ url: z.string() })]).optional(),
});
const LdJsonGraph = z.object({ "@graph": z.array(z.unknown()) });

/** Nome e logo só existem no `ld+json @type:Store` — o resto do DOM não traz nome canônico. */
function findLdJsonStore($: cheerio.CheerioAPI): z.infer<typeof LdJsonStore> | undefined {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse($(el).contents().text());
    } catch {
      continue; // ld+json malformado: ignora esse script, tenta o próximo
    }
    const graph = LdJsonGraph.safeParse(parsed);
    const nodes = graph.success ? graph.data["@graph"] : [parsed];
    for (const node of nodes) {
      const store = LdJsonStore.safeParse(node);
      if (store.success) return store.data;
    }
  }
  return undefined;
}

/**
 * Parse puro: HTML de página de loja do méliuz → desfecho do slug. Sem I/O.
 *
 * Ausência de `.hero-sec` (sinal de presença da página) é `soft_block`, nunca
 * "sem cashback" — quem chama decide se retenta. Nome ausente apesar do `.hero-sec`
 * presente também é `soft_block`: o ld+json Store é metadado de SEO, sempre presente
 * numa página bem servida, independente de a loja ter cashback ou não.
 *
 * O botão já traz o texto pronto ("Ativar até 10% de cashback" / "Ativar R$ 25,00 de
 * cashback") — o adapter só tira o verbo de ação, nunca reextrai valor/is_upto daqui
 * (ADR-0001: adapter só extrai, quem interpreta é `parseReward` no pipeline). Reextrair
 * com regex própria arriscaria rotular um formato desconhecido como `no_cashback` (um
 * desfecho de negócio) quando na verdade é texto que não casa com nenhum formato
 * conhecido — exatamente a confusão que farejo-typescript §3 proíbe.
 */
export function parseMeliuzStorePage(html: string, slug: string): SlugOutcome {
  const $ = cheerio.load(html);
  const canonical = $("link[rel='canonical']").attr("href");
  const isCouponOnlyPage =
    canonical !== undefined &&
    new URL(canonical, BASE).pathname === `/desconto/${slug}` &&
    /^cupom\s+.+\s+de\s+/iu.test($("h1").first().text().trim());
  if (isCouponOnlyPage) return { slug, outcome: "no_cashback" };
  if ($(".hero-sec").length === 0) {
    return { slug, outcome: "soft_block" };
  }

  const store = findLdJsonStore($);
  const name = store?.name;
  if (!name) return { slug, outcome: "soft_block" };
  const logoUrl = typeof store?.image === "string" ? store.image : store?.image?.url;

  const btnText = $(".hero-sec__redirect-btn button").first().text().replace(/\s+/g, " ").trim();
  if (!/de cashback/i.test(btnText)) return { slug, outcome: "no_cashback" };

  const offer: RawOffer = {
    storeName: name,
    rewardText: btnText.replace(/^ativar\s+/i, ""),
    url: `${BASE}/desconto/${slug}`,
    logoUrl,
  };
  return { slug, outcome: "offer", offer };
}

interface MeliuzScrapeDeps {
  fetchPage: (slug: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  reportSoftBlock?: (slug: string, detail: string) => void;
}

function softBlockDetail(html: string): string {
  const $ = cheerio.load(html);
  return `title=${JSON.stringify($("title").first().text().trim())} canonical=${JSON.stringify($("link[rel='canonical']").attr("href") ?? null)} h1=${JSON.stringify($("h1").first().text().trim())} button=${JSON.stringify($("button").first().text().replace(/\s+/g, " ").trim())}`;
}

/** Um slug, com retry por backoff fixo enquanto o desfecho for `soft_block`. */
async function scrapeSlugWithBackoff(slug: string, deps: MeliuzScrapeDeps): Promise<SlugOutcome> {
  let last: SlugOutcome = { slug, outcome: "soft_block" };
  for (let attempt = 0; attempt <= SOFT_BLOCK_BACKOFFS_MS.length; attempt++) {
    let outcome: SlugOutcome;
    try {
      const html = await deps.fetchPage(slug);
      outcome = parseMeliuzStorePage(html, slug);
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
 * nunca visita o diretório inteiro. Circuit breaker conta soft-blocks CONSECUTIVOS — um
 * outcome que não é soft-block zera o contador (ADR-0005 decisão 1), igual ao cuponomia.
 */
export async function scrapeMeliuzSlugs(
  instruction: ScrapeInstruction,
  deps: MeliuzScrapeDeps,
): Promise<ScrapeResult> {
  if (instruction.target.kind !== "slugs") {
    throw new Error("meliuz: scrape requer instruction.target.kind === 'slugs'");
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
        throw new CircuitBreakerError(`meliuz: ${CIRCUIT_BREAKER_THRESHOLD} soft-blocks consecutivos`, {
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

export const meliuzAdapter: PlatformAdapter = {
  platformId: "meliuz",
  async scrape(instruction: ScrapeInstruction) {
    return scrapeMeliuzSlugs(instruction, {
      fetchPage: async (slug) => {
        const response = await fetchTextResponse(`${BASE}/desconto/${slug}`, {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        });
        if (isMeliuzDirectoryRedirect(response.finalUrl)) {
          throw new NotFoundError(`meliuz: ${slug} redirecionou para o diretório`);
        }
        return response.text;
      },
      sleep: realSleep,
      reportSoftBlock: (slug, detail) => console.warn(`[meliuz] soft_block ${slug}: ${detail}`),
    });
  },
};
