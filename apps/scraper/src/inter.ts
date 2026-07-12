import { RetryableError, type PlatformAdapter, type RawOffer, type ScrapeResult } from "@farejo/shared";
import { z } from "zod";

const STORE_BASE = "https://shopping.inter.co/site-parceiro/lojas";
const API_URL =
  "https://marketplace-api.web.bancointer.com.br/site/affiliate/inter/v1/search/stores?lang=pt-BR&limit=400&offset=0";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
};

// Shape cru da API do inter (docs/poc/README.md §1). `shared` nunca vê isto — só RawOffer.
const InterStore = z.object({
  slug: z.string(),
  name: z.string(),
  fullCashback: z.string(),
  fullCashbackValue: z.number(),
  partialCashback: z.string(),
  previousCashback: z.string().optional(),
  imageUrl: z.string(),
});

// Só o envelope é garantido pelo contrato da API; cada item é validado à parte
// abaixo, para uma loja malformada não derrubar o parse das outras 373.
const InterEnvelope = z.object({
  stores: z.array(z.unknown()),
  pagination: z.object({ total: z.number() }),
});

/**
 * Parse puro: resposta crua da API do inter → ScrapeResult. Sem I/O.
 * `fullCashbackValue: 0` ("Ofertas disponíveis") = loja inativa, não emite oferta.
 * `partialCashback` vai pro canal genérico `partialRewardText` — este módulo não
 * sabe que é o tier "não-correntista"; isso é conhecimento do pipeline.
 */
export function parseInter(json: string): ScrapeResult {
  const { stores, pagination } = InterEnvelope.parse(JSON.parse(json));

  const offers: RawOffer[] = [];
  for (const raw of stores) {
    const parsed = InterStore.safeParse(raw);
    if (!parsed.success) continue;
    const store = parsed.data;
    if (store.fullCashbackValue === 0) continue;
    offers.push({
      storeName: store.name,
      rewardText: store.fullCashback,
      previousRewardText: store.previousCashback,
      partialRewardText: store.partialCashback,
      url: `${STORE_BASE}/${store.slug}`,
      logoUrl: store.imageUrl,
    });
  }

  return {
    offers,
    scope: { kind: "full" },
    declaredTotal: pagination.total,
    rawCount: stores.length,
    softBlocks: 0,
  };
}

async function fetchInterStores(): Promise<string> {
  const res = await fetch(API_URL, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new RetryableError(`HTTP ${res.status} em ${API_URL}`);
  return res.text();
}

export const interAdapter: PlatformAdapter = {
  platformId: "inter",
  async scrape() {
    return parseInter(await fetchInterStores());
  },
};
