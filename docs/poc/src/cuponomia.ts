import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as cheerio from "cheerio";
import { fetchHtml, report, saveFixture, sleep, type RawOffer } from "./shared.js";

const BASE = "https://www.cuponomia.com.br";

/** Passo 1 — diretório /desconto: ul.list-letter > li > a. Retorna slugs únicos. */
export function parseCuponomiaDirectory(html: string): string[] {
  const $ = cheerio.load(html);
  const slugs = new Set<string>();
  $("ul.list-letter a[href^='/desconto/']").each((_, el) => {
    const href = ($(el).attr("href") ?? "").split("?")[0];
    const slug = href.replace("/desconto/", "").trim();
    if (slug) slugs.add(slug);
  });
  return [...slugs];
}

/** Vírgula decimal BR → número. "0,01500" → 0.015 · "8,50000" → 8.5 */
const brNum = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * `data-cashback-displayed` NÃO é só "2%" — quando `up-to=true` vem **"até 4%"**
 * (24 lojas no crawl de 09/07/2026). Sem tirar o prefixo, `parseFloat` devolve NaN.
 * Também cobre "R$ 8,5".
 */
export function parseDisplayed(displayed: string): {
  kind: "percent" | "brl" | "none";
  value: number | null;
  upTo: boolean;
} {
  const d = (displayed ?? "").trim();
  const upTo = /^at[eé]\s+/i.test(d);
  const bare = d.replace(/^at[eé]\s+/i, "").trim();
  if (!/\d/.test(bare)) return { kind: "none", value: null, upTo: false };
  if (/R\$/i.test(bare)) return { kind: "brl", value: brNum(bare.replace(/R\$\s*/i, "")), upTo };
  return { kind: "percent", value: brNum(bare.replace("%", "")), upTo };
}

export interface CuponomiaStore {
  slug: string;
  name: string;
  /** "1,5%" | "R$ 8,5" | "" (inativa) */
  displayed: string;
  /** já vem pronto: "1,5% de cashback" */
  actual: string;
  kind: "percent" | "brl" | "none";
  /** 1.5 (percent) | 8.5 (brl) */
  value: number | null;
  /** data-conversion-rate: 0.015 (percent, fração) | 8.5 (brl) */
  rate: number | null;
  upTo: boolean;
  /** texto do <del>, ex. "(era 1%)" */
  previous: string | null;
  boost: boolean;
  logoUrl: string | null;
}

/**
 * Passo 2 — página da loja. Tudo vem de data-attributes do `.store_header` (estáveis,
 * independem de layout). Slug inexistente → soft-404 (HTTP 200 servindo a home, sem
 * `.store_header`) → null.
 *
 * ⚠️ Boost NÃO se lê com regex sobre `header.text()`: o `.store_header` traz um `<style>`
 * inline (~7 KB de CSS) e qualquer `era 5%` numa regra CSS vira falso positivo. O valor
 * anterior é um elemento: `del.rewardsTag-previous`.
 *
 * ⚠️ Nem toda loja com cashback tem o `aside.rewardsTag` (ex.: hostinger, 15%) →
 * ausência significa `upTo=false`, não "sem cashback".
 */
export function parseCuponomiaStore(html: string, slug: string): CuponomiaStore | null {
  const $ = cheerio.load(html);
  const header = $(".store_header").first();
  if (header.length === 0) return null; // soft-404

  const name = header.attr("data-store-name")?.trim() ?? "";
  const displayed = header.attr("data-cashback-displayed")?.trim() ?? "";
  const actual = header.attr("data-store-cashback-actual")?.trim() ?? "";
  if (!name) return null;

  const tag = header.find("[data-test-id='rewards-tag'], aside.rewardsTag").first();
  const rate = brNum(tag.attr("data-conversion-rate"));
  const del = header.find("del.rewardsTag-previous").first();
  const boost = /has-store-boost-cashback/.test(tag.attr("class") ?? "");

  const { kind, value, upTo: uptoFromText } = parseDisplayed(displayed);
  // o aside é a fonte primária; o prefixo "até " no displayed é o fallback (nem toda
  // loja com cashback tem aside.rewardsTag — ex.: hostinger, 15%).
  const upTo = tag.attr("data-should-use-up-to") === "true" || uptoFromText;

  return {
    slug,
    name,
    displayed,
    actual,
    kind,
    value,
    rate,
    upTo,
    previous: del.length ? del.text().trim() : null,
    boost,
    logoUrl: header.find("img").first().attr("src") ?? null,
  };
}

/** Adaptação p/ o contrato do pipeline. Loja sem cashback → null (F8). */
export function parseCuponomiaStorePage(html: string, slug: string): RawOffer | null {
  const s = parseCuponomiaStore(html, slug);
  if (!s || s.kind === "none") return null;
  return {
    storeName: s.name,
    rewardText: s.actual || `${s.upTo ? "até " : ""}${s.displayed} de cashback`,
    previousRewardText: s.previous ? s.previous.replace(/^\(|\)$/g, "") : undefined,
    url: `${BASE}/desconto/${slug}`,
    logoUrl: s.logoUrl ?? undefined,
  };
}

// só roda o POC quando executado direto — senão `import` deste módulo dispara fetch/relatório.
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const live = process.argv.includes("--live");

if (!isMain) {
  // importado (ex.: cup-crawl.ts) — nada a fazer
} else if (live) {
  const dirHtml = await fetchHtml(`${BASE}/desconto`);
  saveFixture("cuponomia-desconto.html", dirHtml);
  const slugs = parseCuponomiaDirectory(dirHtml);
  console.log(`diretório: ${slugs.length} lojas`);

  const offers: RawOffer[] = [];
  for (const slug of slugs.slice(0, 5)) {
    // amostra de 5 no POC; no adapter real são todas, com o mesmo delay
    const html = await fetchHtml(`${BASE}/desconto/${slug}`);
    const offer = parseCuponomiaStorePage(html, slug);
    if (offer) offers.push(offer);
    await sleep(1000);
  }
  saveFixture("cuponomia-loja-exemplo.html", await fetchHtml(`${BASE}/desconto/${slugs[0]}`));
  report("cuponomia.com.br (amostra de 5)", offers);
} else {
  const dirHtml = readFileSync(new URL("../fixtures/cuponomia-desconto.sample.html", import.meta.url), "utf8");
  const slugs = parseCuponomiaDirectory(dirHtml);
  console.log(`diretório (fixture): ${slugs.length} slugs → ${slugs.join(", ")}`);

  const offers = [
    parseCuponomiaStorePage(readFileSync(new URL("../fixtures/cuponomia-loja.sample.html", import.meta.url), "utf8"), "nike-store"),
    parseCuponomiaStorePage(readFileSync(new URL("../fixtures/cuponomia-loja-boost.sample.html", import.meta.url), "utf8"), "nike-store"),
  ].filter((o): o is RawOffer => o !== null);

  report("cuponomia.com.br (fixtures)", offers);
}
// Validação esperada: --live diretório ≈ 799; fixtures = 6 slugs + 2 ofertas (1 com boost "era 2%").
