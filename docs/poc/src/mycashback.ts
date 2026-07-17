import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { fetchHtml, report, saveFixture, type RawOffer } from "./shared.js";

const BASE = "https://www.mycashback.com.br";
const LIST_URL = `${BASE}/all-shops`;

/**
 * Parser do mycashback.com.br/all-shops.
 * Estrutura Bootstrap com classes semânticas: div.card > a.info > .title + .cbDetails.
 * 468 lojas numa única página (validado em 09/07/2026), sem paginação.
 * Loja sem cashback ativo = card sem span.cbDetails → ignorada (requisito F8).
 */
export function parseMycashback(html: string): RawOffer[] {
  const $ = cheerio.load(html);
  const offers: RawOffer[] = [];
  const seen = new Set<string>();

  $("div.card a.info").each((_, el) => {
    const a = $(el);
    const href = (a.attr("href") ?? "").split("?")[0];
    const name = a.find("span.title").text().trim();
    const rewardText = a.find("span.cbDetails").text().trim();

    if (!href.includes("/retailer/") && !href.startsWith("/retailer")) return;
    if (!name || !rewardText || seen.has(href)) return;
    seen.add(href);

    // lazysizes: o `src` é sempre /img/noimage.jpg (468/468); o logo real está em data-src.
    const img = a.find("img.product-logo");
    const rawLogo = img.attr("data-src") ?? img.attr("src");

    offers.push({
      storeName: name,
      rewardText,
      url: new URL(href, BASE).href,
      logoUrl: rawLogo ? new URL(rawLogo, BASE).href : undefined,
    });
  });

  return offers;
}

const live = process.argv.includes("--live");
const html = live
  ? await fetchHtml(LIST_URL)
  : readFileSync(new URL("../fixtures/mycashback-all-shops.sample.html", import.meta.url), "utf8");
if (live) saveFixture("mycashback-all-shops.html", html);

report("mycashback.com.br", parseMycashback(html));
// Validação esperada: --live ≈ 468 lojas; fixture sample = 6 (a 7ª não tem cbDetails e deve ficar de fora).
