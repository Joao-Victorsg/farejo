import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { fetchHtml, sleep } from "./shared.js";
import { MELIUZ_CATEGORIES, parseMeliuzCategory } from "./meliuz.js";

const BASE = "https://www.meliuz.com.br";
const slugOf = (u: string) => u.split("?")[0].replace(/\/+$/, "").split("/").pop() || "";

// ---------- 1. Directory slugs (from saved fixture) ----------
const dirHtml = readFileSync(new URL("../fixtures/meliuz-desconto.html", import.meta.url), "utf8");
const dirSlugs = new Set<string>();
for (const m of dirHtml.matchAll(/\/desconto\/([a-z0-9][a-z0-9-]*)/g)) dirSlugs.add(m[1]);
console.log(`Diretório /desconto: ${dirSlugs.size} slugs únicos`);

// ---------- 2. Hot set (21 categories, live) ----------
console.log(`\nBuscando ${MELIUZ_CATEGORIES.length} categorias para o hot set...`);
const hotSlugs = new Set<string>();
for (const cat of MELIUZ_CATEGORIES) {
  try {
    const html = await fetchHtml(`${BASE}/cupom/${cat}`);
    const offers = parseMeliuzCategory(html);
    for (const o of offers) hotSlugs.add(slugOf(o.url));
    process.stdout.write(`  ${cat}: ${offers.length}  `);
  } catch (e) {
    process.stdout.write(`  ${cat}: ERRO(${(e as Error).message.slice(0, 30)})  `);
  }
  await sleep(1000);
}
console.log(`\nHot set: ${hotSlugs.size} lojas únicas com valor`);

// ---------- 3. Coverage: tail = directory − hotset ----------
const inDir = [...hotSlugs].filter((s) => dirSlugs.has(s)).length;
const tail = [...dirSlugs].filter((s) => !hotSlugs.has(s));
console.log(`\n=== COBERTURA ===`);
console.log(`  hot set contido no diretório: ${inDir}/${hotSlugs.size}`);
console.log(`  CAUDA (no diretório, fora do hot set): ${tail.length}`);

// ---------- 4. Sample tail → measure % with cashback ----------
function cashbackSignal(html: string): { has: boolean; text: string } {
  const $ = cheerio.load(html);
  // hero redirect button: "Ativar até X% de cashback"
  let btn = "";
  $(".hero-sec__redirect-btn button, .hero-sec button[data-redirect-url]").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (/cashback/i.test(t)) btn = t;
  });
  // base rate breakdown
  const mainRate = $(".hero-sec__cashback-category strong[data-main]").first().text().trim();
  const has = (/\d/.test(btn) && /cashback/i.test(btn)) || /\d/.test(mainRate);
  return { has, text: btn || (mainRate ? `[cat main ${mainRate}]` : "(sem botão cashback)") };
}

const N = 120;
const step = Math.max(1, Math.floor(tail.length / N));
const sample = tail.filter((_, i) => i % step === 0).slice(0, N);
console.log(`\n=== AMOSTRA da cauda: ${sample.length} lojas (1 a cada ${step}) ===`);

let withCb = 0, without = 0, errors = 0;
const examplesWithout: string[] = [];
for (const slug of sample) {
  try {
    const html = await fetchHtml(`${BASE}/desconto/${slug}`);
    const { has, text } = cashbackSignal(html);
    if (has) withCb++;
    else { without++; if (examplesWithout.length < 8) examplesWithout.push(`${slug} :: ${text}`); }
    process.stdout.write(has ? "✓" : "·");
  } catch (e) {
    errors++;
    process.stdout.write("x");
  }
  await sleep(1000);
}

const valid = withCb + without;
const pct = valid ? ((withCb / valid) * 100).toFixed(0) : "0";
console.log(`\n\n=== RESULTADO AMOSTRA ===`);
console.log(`  com cashback: ${withCb}`);
console.log(`  sem cashback: ${without}`);
console.log(`  erros/404:    ${errors}`);
console.log(`  => ${pct}% da cauda tem cashback (n=${valid})`);
console.log(`\n  Estimativa: ~${Math.round((tail.length * withCb) / (valid || 1))} lojas da cauda com cashback`);
console.log(`  + hot set (${hotSlugs.size}) = ~${Math.round((tail.length * withCb) / (valid || 1)) + hotSlugs.size} lojas ativas no total`);
console.log(`\n  exemplos SEM cashback (para validar o sinal):`);
examplesWithout.forEach((e) => console.log(`    - ${e}`));
