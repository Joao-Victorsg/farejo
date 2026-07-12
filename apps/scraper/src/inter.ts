import type { PlatformAdapter, RawOffer, ScrapeInstruction, ScrapeResult } from "@farejo/shared";
import { z } from "zod";
import { fetchText } from "./http.js";

const STORE_BASE = "https://shopping.inter.co/site-parceiro/lojas";
const API_URL =
  "https://marketplace-api.web.bancointer.com.br/site/affiliate/inter/v1/search/stores?lang=pt-BR&limit=400&offset=0";

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

export const interAdapter: PlatformAdapter = {
  platformId: "inter",
  // Site de 1 request, sem tiers: ignora a instrução (sempre full, sem throttle).
  async scrape(_instruction: ScrapeInstruction) {
    return parseInter(await fetchText(API_URL, { Accept: "application/json" }));
  },
};
