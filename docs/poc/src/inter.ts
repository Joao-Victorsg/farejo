import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { fetchHtml, report, saveFixture, type RawOffer } from "./shared.js";

const BASE = "https://shopping.inter.co";
const LIST_URL = `${BASE}/site-parceiro/lojas?category=ALL-STORES`;

/**
 * Parser do shopping.inter.co.
 * Seletores primários: data-testid (estáveis). Fallback: prefixo semântico das
 * classes styled-components (o hash sufixo muda entre deploys; o prefixo não).
 */
export function parseInter(html: string): RawOffer[] {
  const $ = cheerio.load(html);
  const offers: RawOffer[] = [];

  $('[data-testid="store-card"]').each((_, el) => {
    const card = $(el);
    const href = card.find('a[data-testid="store-url"]').attr("href") ?? "";
    const name = (card.find("img").attr("alt") ?? "").replace(/ logo$/i, "").trim();
    const rewardText = card.find('[class*="CashbackValue"]').first().text().trim();
    const previous = card.find('[class*="PreviousCashback"]').first().text().trim();

    if (!name || !href || !rewardText) return; // card sem cashback ativo → não é oferta
    offers.push({
      storeName: name,
      rewardText,
      previousRewardText: previous || undefined,
      url: new URL(href, BASE).href,
      logoUrl: card.find("img").attr("src"),
    });
  });

  return offers;
}

const live = process.argv.includes("--live");
const html = live
  ? await fetchHtml(LIST_URL)
  : readFileSync(new URL("../fixtures/inter-lojas.sample.html", import.meta.url), "utf8");
if (live) saveFixture("inter-lojas.html", html);

report("shopping.inter.co", parseInter(html));
// Validação esperada: --live ≈ 374 cards (366+ com valor); fixture sample = 14.
