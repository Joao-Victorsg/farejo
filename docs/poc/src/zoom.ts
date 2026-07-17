import { readFileSync } from "node:fs";
import { fetchHtml, report, saveFixture, type RawOffer } from "./shared.js";

const BASE = "https://www.zoom.com.br";
const LIST_URL = `${BASE}/cupom-de-desconto/lojas`;

/**
 * O diretório do zoom é Next.js App Router: o HTML servido renderiza só ~24 cards,
 * mas o payload RSC (`self.__next_f`) embute as **212 lojas** com os valores.
 * Fonte da verdade = esse JSON, não o DOM (parsear o DOM perde 88% das lojas).
 * 1 request, sem paginação — `?page=N` é ignorado pelo servidor.
 */
export interface ZoomSeller {
  id: string;
  name: string;
  cashbackModality: {
    allMerchant: number | null;
    bestFormula: number | null;
    offerRates: { min: number; max: number } | null;
    categories: Array<{ cashbackRate?: number }> | null;
    categoryRates: unknown;
  } | null;
  paths: { homePage: string };
  logoUrls?: { mediumRoundend?: string };
}

/** Concatena os chunks do flight RSC e recorta o array `sellers` por balanceamento de colchetes. */
export function extractZoomSellers(html: string): ZoomSeller[] {
  let flight = "";
  for (const p of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try {
      const a = JSON.parse(p[1]);
      if (typeof a[1] === "string") flight += a[1];
    } catch {
      /* chunk não-JSON: ignora */
    }
  }
  const key = '"sellers":';
  const at = flight.indexOf(`${key}[`);
  if (at < 0) return [];
  const start = at + key.length;
  let depth = 0;
  for (let i = start; i < flight.length; i++) {
    if (flight[i] === "[") depth++;
    else if (flight[i] === "]" && --depth === 0) return JSON.parse(flight.slice(start, i + 1));
  }
  return [];
}

/**
 * Port fiel de `hasMultipleCashback` (chunk 19933, módulo 28487) — é o que liga o "até".
 * Conta quantas taxas POSITIVAS existem; >1 ⇒ "até". Repare que não compara min≠max:
 * a Fast Shop tem allMerchant=min=max=0,06 (3 positivos) e exibe "até 6%".
 */
export function hasMultipleCashback(m: ZoomSeller["cashbackModality"]): boolean {
  const cats = (m?.categories ?? []).map((c) => c?.cashbackRate || 0);
  return [m?.allMerchant, m?.offerRates?.min, m?.offerRates?.max, ...cats].filter((v) => (v ?? 0) > 0).length > 1;
}

/** `bestFormula` é fração (0,005 = 0,5%). O ×100 introduz ruído binário — corta em 4 casas. */
const toPercent = (frac: number): number => parseFloat((frac * 100).toFixed(4));

export function parseZoomSellers(sellers: ZoomSeller[]): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const s of sellers) {
    const m = s.cashbackModality;
    const best = m?.bestFormula ?? 0;
    if (!(best > 0)) continue; // F8: inativa (bestFormula null; nunca 0). allMerchant NÃO serve de gate.
    if (!s.name || !s.paths?.homePage) continue;

    offers.push({
      storeName: s.name,
      rewardText: `${hasMultipleCashback(m) ? "até " : ""}${toPercent(best)}% de volta`,
      url: new URL(s.paths.homePage, BASE).href,
      logoUrl: s.logoUrls?.mediumRoundend,
    });
  }
  return offers;
}

export function parseZoomDirectory(html: string): RawOffer[] {
  return parseZoomSellers(extractZoomSellers(html));
}

/** O header "N lojas encontradas" é cross-check independente do array — divergiu, o flight mudou. */
export function declaredCount(html: string): number | null {
  const m = html.match(/(\d+)\s+lojas encontradas/);
  return m ? Number(m[1]) : null;
}

const live = process.argv.includes("--live");
const html = live
  ? await fetchHtml(LIST_URL)
  : readFileSync(new URL("../fixtures/zoom-lojas.html", import.meta.url), "utf8");

if (live) saveFixture("zoom-lojas.html", html);

const sellers = extractZoomSellers(html);
const declared = declaredCount(html);
if (live && sellers.length) saveFixture("zoom-sellers.json", JSON.stringify(sellers, null, 2));
if (sellers.length === 0) {
  console.log(`⚠️ flight sem \`sellers\` — layout mudou ou bloqueio. (bytes: ${html.length})`);
} else if (declared !== null && declared !== sellers.length) {
  console.log(`⚠️ header diz ${declared} lojas, flight tem ${sellers.length} — investigar antes de gravar.`);
}

const offers = parseZoomDirectory(html);
console.log(`lojas no flight: ${sellers.length} (header: ${declared}) | inativas: ${sellers.length - offers.length}`);
report(`zoom.com.br (${live ? "live" : "fixture"})`, offers);
console.log(`Paginação: nenhuma — as ${sellers.length} lojas vêm em 1 request.`);
// Validação esperada (09/07/2026): 212 lojas, 171 ofertas, 1 "até" (Fast Shop).
