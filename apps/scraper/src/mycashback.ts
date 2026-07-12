import type { PlatformAdapter, RawOffer, ScrapeInstruction, ScrapeResult } from "@farejo/shared";
import * as cheerio from "cheerio";
import { fetchText } from "./http.js";

const BASE = "https://www.mycashback.com.br";
const LIST_URL = `${BASE}/all-shops`;

// O href do card às vezes vem com um prefixo repetido "/home/home/.../" (bug visto ao
// vivo em algumas lojas); extrair só o segmento real basta pra montar a URL certa.
const RETAILER_PATH_RE = /\/retailer\/[^/?]+/;
const NO_CASHBACK_RE = /sem\s+cashback/i;

/**
 * Parse puro: HTML de mycashback.com.br/all-shops → ScrapeResult. Sem I/O.
 * "Sem  Cashback" (dois espaços) no `.cbDetails` é sinal explícito de loja inativa —
 * não a ausência do elemento. `!/\d/` cobre qualquer outra variação sem número.
 * Sem `declaredTotal`: o diretório não declara um total de máquina autoritativo.
 */
export function parseMycashback(html: string): ScrapeResult {
  const $ = cheerio.load(html);
  const cards = $("div.card a.info");

  const offers: RawOffer[] = [];
  cards.each((_, el) => {
    const a = $(el);
    const retailerPath = RETAILER_PATH_RE.exec(a.attr("href") ?? "")?.[0];
    const storeName = a.find("span.title").text().trim();
    const rewardText = a.find("span.cbDetails").text().trim();
    if (!retailerPath || !storeName || !rewardText) return;
    if (NO_CASHBACK_RE.test(rewardText) || !/\d/.test(rewardText)) return;

    // lazysizes: `src` é sempre o placeholder /img/noimage.jpg; o logo real está em data-src.
    const img = a.find("img.product-logo");
    const rawLogo = img.attr("data-src") ?? img.attr("src");

    offers.push({
      storeName,
      rewardText,
      url: new URL(retailerPath, BASE).href,
      logoUrl: rawLogo ? new URL(rawLogo, BASE).href : undefined,
    });
  });

  return {
    offers,
    scope: { kind: "full" },
    rawCount: cards.length,
    softBlocks: 0,
  };
}

export const mycashbackAdapter: PlatformAdapter = {
  platformId: "mycashback",
  // Site de 1 request, sem tiers: ignora a instrução (sempre full, sem throttle).
  async scrape(_instruction: ScrapeInstruction) {
    return parseMycashback(
      await fetchText(LIST_URL, {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Cache-Control": "no-cache",
      }),
    );
  },
};
