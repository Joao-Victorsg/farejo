import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { fetchHtml, report, saveFixture, sleep, type RawOffer } from "./shared.js";

const BASE = "https://www.meliuz.com.br";

/** Categorias do menu (validadas em 09/07/2026). ~18 lojas top com valor por categoria. */
export const MELIUZ_CATEGORIES = [
  "celulares-e-smartphones", "viagem-e-turismo", "eletronicos-e-tecnologia",
  "eletrodomesticos", "livros", "informatica", "loja-de-departamentos", "esporte",
  "moda-e-acessorios", "saude", "moveis-casa-e-decoracao", "assinaturas-e-servicos",
  "cursos", "bebes-e-criancas", "beleza-e-saude", "pet-shop", "alimentos-e-bebidas",
  "apostas", "automotivo", "presentes", "seguros-e-financas",
];

/**
 * Parser da página de categoria: a.hot-offers-grid__item.
 * Nome no img[alt]; valor em .hot-offers-grid__item-cashback-label; boost "(era X%)" via regex no texto do card.
 * Cobertura v1 = top lojas por categoria (~200-300 após dedupe). Diretório completo (/desconto, 2.395 lojas) fica p/ v2.
 */
export function parseMeliuzCategory(html: string): RawOffer[] {
  const $ = cheerio.load(html);
  const offers: RawOffer[] = [];

  $("a.hot-offers-grid__item").each((_, el) => {
    const card = $(el);
    const href = (card.attr("href") ?? "").split("?")[0];
    const name = card.find("img").attr("alt")?.trim();
    const rewardText = card
      .find(".hot-offers-grid__item-cashback-label")
      .text()
      .replace(/\s+/g, " ")
      .trim();
    if (!name || !href || !rewardText || !/\d/.test(rewardText)) return;

    const era = card.text().match(/\(era\s+([\d.,]+\s*%)\)/i);
    offers.push({
      storeName: name,
      rewardText,
      previousRewardText: era ? `era ${era[1]}` : undefined,
      url: new URL(href, BASE).href,
      logoUrl: card.find("img").attr("src"),
    });
  });

  return offers;
}

/** Dedupe entre categorias: mesma loja aparece em várias; mantém a primeira ocorrência. */
export function dedupeBySlug(offers: RawOffer[]): RawOffer[] {
  const seen = new Set<string>();
  return offers.filter((o) => (seen.has(o.url) ? false : (seen.add(o.url), true)));
}

const live = process.argv.includes("--live");

if (live) {
  const all: RawOffer[] = [];
  for (const cat of MELIUZ_CATEGORIES) {
    const html = await fetchHtml(`${BASE}/cupom/${cat}`);
    if (cat === "moda-e-acessorios") saveFixture("meliuz-categoria.html", html);
    all.push(...parseMeliuzCategory(html));
    await sleep(1000);
  }
  report("meliuz.com.br (21 categorias)", dedupeBySlug(all));
} else {
  const html = readFileSync(new URL("../fixtures/meliuz-categoria.sample.html", import.meta.url), "utf8");
  report("meliuz.com.br (fixture)", parseMeliuzCategory(html));
}
// Validação esperada: --live ≈ 200-380 ofertas após dedupe; fixture = 6 (3 com boost).
