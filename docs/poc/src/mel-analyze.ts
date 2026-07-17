import { readFileSync, writeFileSync } from "node:fs";
import { fetchHtml, sleep } from "./shared.js";
import { MELIUZ_CATEGORIES, parseMeliuzCategory } from "./meliuz.js";

const BASE = "https://www.meliuz.com.br";
const slugOf = (u: string) => u.split("?")[0].replace(/\/+$/, "").split("/").pop() || "";

type Rec = { slug: string; has?: boolean; value?: string | null; upTo?: boolean; mainRate?: string | null; btn?: string | null; gone?: boolean; error?: string };
const recs: Rec[] = readFileSync(new URL("../fixtures/meliuz-crawl.jsonl", import.meta.url), "utf8")
  .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

const active = recs.filter((r) => r.has);
const inactive = recs.filter((r) => r.has === false);
const gone = recs.filter((r) => r.gone);
const err = recs.filter((r) => r.error);

console.log(`=== CRAWL COMPLETO (${recs.length} lojas) ===`);
console.log(`  com cashback: ${active.length}  (${((active.length / (recs.length - gone.length)) * 100).toFixed(1)}%)`);
console.log(`  cupom-only:   ${inactive.length}`);
console.log(`  404/fora:     ${gone.length}`);
console.log(`  erro:         ${err.length}`);

// sanidade
const activeNoVal = active.filter((r) => !r.value);
const inactiveWithVal = inactive.filter((r) => r.value);
console.log(`\n  [sanidade] has=true sem valor extraído: ${activeNoVal.length}`);
if (activeNoVal.length) console.log(`     ex: ${activeNoVal.slice(0, 5).map((r) => `${r.slug}[${r.btn}]`).join(", ")}`);
console.log(`  [sanidade] has=false mas com valor: ${inactiveWithVal.length}`);

// upTo / distribuição de valores
const upto = active.filter((r) => r.upTo).length;
console.log(`\n  "até X%" (upTo): ${upto} · valor fixo: ${active.length - upto}`);
const buckets: Record<string, number> = {};
for (const r of active) {
  const v = parseFloat((r.value || "0").replace(",", ".").replace("%", ""));
  const b = v <= 1 ? "≤1%" : v <= 3 ? "1–3%" : v <= 5 ? "3–5%" : v <= 10 ? "5–10%" : v <= 20 ? "10–20%" : ">20%";
  buckets[b] = (buckets[b] || 0) + 1;
}
console.log(`  distribuição: ${["≤1%", "1–3%", "3–5%", "5–10%", "10–20%", ">20%"].map((b) => `${b}=${buckets[b] || 0}`).join(" · ")}`);
const top = [...active].sort((a, b) => parseFloat((b.value || "0").replace(",", ".")) - parseFloat((a.value || "0").replace(",", "."))).slice(0, 8);
console.log(`  maiores: ${top.map((r) => `${r.slug}(${r.value}${r.upTo ? "↑" : ""})`).join(", ")}`);

// hot set overlap (re-busca 21 categorias)
console.log(`\nBuscando 21 categorias para overlap com hot set...`);
const hot = new Set<string>();
for (const cat of MELIUZ_CATEGORIES) {
  try {
    const html = await fetchHtml(`${BASE}/cupom/${cat}`);
    for (const o of parseMeliuzCategory(html)) hot.add(slugOf(o.url));
  } catch {}
  await sleep(900);
}
const activeSlugs = new Set(active.map((r) => r.slug));
const hotActive = [...hot].filter((s) => activeSlugs.has(s)).length;
const hotMissed = [...hot].filter((s) => !activeSlugs.has(s));
console.log(`\n=== HOT SET vs CRAWL ===`);
console.log(`  hot set: ${hot.size} lojas`);
console.log(`  hot set detectadas como ativas no crawl: ${hotActive}/${hot.size}`);
if (hotMissed.length) console.log(`  hot set NÃO batidas/ativas no crawl: ${hotMissed.length} (${hotMissed.slice(0, 8).join(", ")})`);
console.log(`  => CAUDA ATIVA (com cashback, fora do hot set): ${active.length - hotActive}`);

// salvar dataset limpo
const dataset = active.map((r) => ({ slug: r.slug, value: r.value, upTo: r.upTo, mainRate: r.mainRate }));
const outPath = new URL("../fixtures/meliuz-active-stores.json", import.meta.url);
writeFileSync(outPath, JSON.stringify(dataset, null, 0), "utf8");
console.log(`\nDataset salvo: fixtures/meliuz-active-stores.json (${dataset.length} lojas ativas)`);
