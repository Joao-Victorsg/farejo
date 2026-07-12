import { RetryableError, type PlatformAdapter, type RawOffer, type ScrapeInstruction, type ScrapeResult } from "@farejo/shared";
import { z } from "zod";
import { fetchText } from "./http.js";

const BASE = "https://www.zoom.com.br";
const LIST_URL = `${BASE}/cupom-de-desconto/lojas`;

/**
 * O diretório do zoom é Next.js App Router: o HTML servido renderiza só ~24 cards,
 * mas o payload RSC (`self.__next_f`) embute as 212 lojas com os valores. Fonte da
 * verdade = esse JSON, não o DOM. 1 request, sem paginação (`?page=N` é ignorado).
 * Shape cru do bundle do zoom — `shared` nunca vê isto, só `RawOffer`.
 */
const ZoomSeller = z.object({
  name: z.string(),
  cashbackModality: z
    .object({
      allMerchant: z.number().nullable(),
      bestFormula: z.number().nullable(),
      offerRates: z.object({ min: z.number(), max: z.number() }).nullable(),
      categories: z.array(z.object({ cashbackRate: z.number().optional() })).nullable(),
    })
    .nullable(),
  paths: z.object({ homePage: z.string() }),
  logoUrls: z.object({ mediumRoundend: z.string().optional() }).optional(),
});
type ZoomSeller = z.infer<typeof ZoomSeller>;

/**
 * Concatena os chunks do flight RSC e recorta o array `sellers` cru por balanceamento
 * de colchetes. Ausência da chave `"sellers":` ou colchete nunca fechado é sinal de
 * presença falhando (layout mudou ou bloqueio) — retentável, nunca "0 lojas" silencioso.
 */
function extractRawSellers(html: string): unknown[] {
  let flight = "";
  for (const p of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try {
      if (!p[1]) continue;
      const chunk = JSON.parse(p[1]);
      if (typeof chunk[1] === "string") flight += chunk[1];
    } catch {
      // chunk não-JSON: ignora
    }
  }
  const key = '"sellers":';
  const at = flight.indexOf(`${key}[`);
  if (at < 0) throw new RetryableError('zoom: flight RSC sem a chave "sellers" — layout mudou ou bloqueio');
  const start = at + key.length;
  let depth = 0;
  for (let i = start; i < flight.length; i++) {
    if (flight[i] === "[") depth++;
    else if (flight[i] === "]" && --depth === 0) return JSON.parse(flight.slice(start, i + 1));
  }
  throw new RetryableError("zoom: array \"sellers\" nunca fechou no flight RSC — payload truncado ou malformado");
}

// Cada item é validado à parte: uma loja malformada não derruba o parse das outras 211.
function parseValidSellers(rawSellers: unknown[]): ZoomSeller[] {
  return rawSellers
    .map((raw) => ZoomSeller.safeParse(raw))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}

/**
 * Port fiel de `hasMultipleCashback` do bundle do zoom — é o que liga o "até". Conta
 * quantas taxas POSITIVAS existem; >1 ⇒ "até". Não compara min≠max: a Fast Shop tem
 * allMerchant=min=max=0,06 (3 positivos) e exibe "até 6%".
 */
function hasMultipleCashback(m: ZoomSeller["cashbackModality"]): boolean {
  const cats = (m?.categories ?? []).map((c) => c?.cashbackRate || 0);
  return [m?.allMerchant, m?.offerRates?.min, m?.offerRates?.max, ...cats].filter((v) => (v ?? 0) > 0).length > 1;
}

/** `bestFormula` é fração (0,005 = 0,5%). O ×100 introduz ruído binário — corta em 4 casas. */
const toPercent = (frac: number): number => Number.parseFloat((frac * 100).toFixed(4));

function parseZoomSellers(sellers: ZoomSeller[]): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const s of sellers) {
    const m = s.cashbackModality;
    const best = m?.bestFormula ?? 0;
    if (!(best > 0)) continue; // inativa (bestFormula null; nunca 0). allMerchant NÃO serve de gate.
    if (!s.name) continue;

    offers.push({
      storeName: s.name,
      rewardText: `${hasMultipleCashback(m) ? "até " : ""}${toPercent(best)}% de volta`,
      url: new URL(s.paths.homePage, BASE).href,
      logoUrl: s.logoUrls?.mediumRoundend,
    });
  }
  return offers;
}

/** O header "N lojas encontradas" é cross-check independente do array — divergiu, o flight mudou. */
function declaredCount(html: string): number | undefined {
  const m = html.match(/(\d+)\s+lojas encontradas/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Parse puro: HTML do diretório do zoom → ScrapeResult. Sem I/O.
 * `rawCount` conta o array `sellers` cru inteiro (212), antes de validação e do filtro
 * `bestFormula > 0` — um item malformado ainda foi "recebido", só não vira oferta.
 */
export function parseZoom(html: string): ScrapeResult {
  const rawSellers = extractRawSellers(html);
  return {
    offers: parseZoomSellers(parseValidSellers(rawSellers)),
    scope: { kind: "full" },
    declaredTotal: declaredCount(html),
    rawCount: rawSellers.length,
    softBlocks: 0,
  };
}

export const zoomAdapter: PlatformAdapter = {
  platformId: "zoom",
  // Site de 1 request, sem tiers: ignora a instrução (sempre full, sem throttle).
  async scrape(_instruction: ScrapeInstruction) {
    return parseZoom(
      await fetchText(LIST_URL, {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      }),
    );
  },
};
