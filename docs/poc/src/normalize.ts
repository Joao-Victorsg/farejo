import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as cheerio from "cheerio";

/**
 * POC de normalização de nomes de loja (alimenta a tabela `store_aliases`).
 *
 * Pergunta central: dá para casar "Nike" (inter) com "Nike Store" (cuponomia) sem
 * casar por engano duas lojas DIFERENTES do mesmo site?
 *
 * Métrica de segurança: **colisão intra-site**. Se dois nomes distintos do MESMO site
 * colapsam na mesma chave, a regra está agressiva demais — nenhum portal lista a mesma
 * loja duas vezes com nomes diferentes. Um merge falso mostra o cashback ERRADO;
 * um merge perdido só deixa de comparar. O primeiro é muito pior → normalizar conservador
 * e mandar o resto para uma tabela de alias curada.
 */
const F = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), "utf8");
const has = (p: string) => existsSync(new URL(`../fixtures/${p}`, import.meta.url));

export type Site = "inter" | "zoom" | "mycashback" | "cuponomia" | "meliuz";

export function loadNames(): Record<Site, string[]> {
  const inter = (JSON.parse(F("inter-stores.api.json")).stores as any[]).map((s) => s.name);
  const zoom = (JSON.parse(F("zoom-sellers.json")) as any[]).map((s) => s.name);

  const $m = cheerio.load(F("mycashback-all-shops.html"));
  const mycashback: string[] = [];
  $m("div.card a.info").each((_, el) => {
    const n = $m(el).find("span.title").text().trim();
    if (n) mycashback.push(n);
  });

  const $c = cheerio.load(F("cuponomia-desconto.html"));
  const cuponomia: string[] = [];
  $c("ul.list-letter a[href^='/desconto/']").each((_, el) => {
    const n = $c(el).text().trim();
    if (n) cuponomia.push(n);
  });

  // méliuz: só a amostra (o dataset completo não guarda nome; o adapter pega do ld+json)
  const meliuz = has("meliuz-store-sample.json")
    ? (JSON.parse(F("meliuz-store-sample.json")) as any[]).map((s) => s.name).filter(Boolean)
    : [];

  return { inter, zoom, mycashback, cuponomia, meliuz };
}

// ---------- canonicalização ----------
const deaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** L0: caixa baixa + espaços colapsados. */
export const canonL0 = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * L1: L0 + sem acento, sem domínio, sem pontuação.
 * `+` vira "plus" ANTES de matar pontuação, senão "Disney+" colide com "Disney".
 */
export function canonL1(s: string): string {
  let t = deaccent(s.toLowerCase());
  t = t.replace(/\+/g, " plus ");
  t = t.replace(/&/g, " e ");
  t = t.replace(/\.com\.br\b|\.com\b|\.br\b/g, " ");
  t = t.replace(/[^a-z0-9]+/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

/**
 * L2 (a chave que vai pro banco): L1 sem espaços. Não remove nada — só junta.
 * Resolve "Fast Shop"×"Fastshop", "123 Milhas"×"123milhas", "Casas Bahia"×"casasbahia.com.br".
 * Mantém "Disney+"≠"Disney Store" e "Nike"≠"Nike Store" (estes vão p/ alias curado).
 */
export const canonL2 = (s: string) => canonL1(s).replace(/ /g, "");

/** Decoradores. Tentador remover — e errado: "Shop" é marca em "Fast Shop", enfeite em "Nike Store". */
const DECOR = new Set(["loja", "lojas", "store", "shop", "oficial", "online", "brasil", "br"]);

/** L3: L2 + remove decorador. NÃO usar como chave — só para SUGERIR alias. */
export function canonL3(s: string): string {
  const kept = canonL1(s).split(" ").filter((t) => t && !DECOR.has(t));
  return (kept.length ? kept : canonL1(s).split(" ")).join("");
}

// ---------- avaliação ----------
type Canon = (s: string) => string;

function evaluate(label: string, canon: Canon, data: Record<Site, string[]>, sites: Site[]) {
  let collisions = 0;
  const examples: string[] = [];
  for (const s of sites) {
    const byKey = new Map<string, Set<string>>();
    for (const n of data[s]) {
      const k = canon(n);
      if (!byKey.has(k)) byKey.set(k, new Set());
      byKey.get(k)!.add(n);
    }
    for (const [k, ns] of byKey) if (ns.size > 1) {
      collisions++;
      if (examples.length < 4) examples.push(`${s}: ${[...ns].join(" ≠ ")} → "${k}"`);
    }
  }
  const keyToSites = new Map<string, Set<Site>>();
  for (const s of sites) for (const n of data[s]) {
    const k = canon(n);
    if (!keyToSites.has(k)) keyToSites.set(k, new Set());
    keyToSites.get(k)!.add(s);
  }
  const multi = [...keyToSites.values()].filter((v) => v.size >= 2).length;
  console.log(`${label.padEnd(34)} chaves=${String(keyToSites.size).padStart(4)}  ≥2 sites=${String(multi).padStart(3)}  colisões=${collisions} ${collisions ? "⚠️" : "✅"}`);
  examples.forEach((e) => console.log(`      ${e}`));
}

/** Levenshtein (sem dep) para pegar plural/typo que a chave exata perde. */
function lev(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const ratio = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length);

const data = loadNames();
const FULL: Site[] = ["inter", "zoom", "mycashback", "cuponomia"]; // sites com nome completo
console.log("nomes:", Object.entries(data).map(([s, n]) => `${s}=${n.length}`).join(" "));
console.log(`(méliuz entra só com a amostra — o dataset não guarda nome; o adapter tira do ld+json)\n`);

evaluate("L0 lowercase", canonL0, data, FULL);
evaluate("L1 +acento/pontuação/domínio", canonL1, data, FULL);
evaluate("L2 ✅ +junta tokens (CHAVE)", canonL2, data, FULL);
evaluate("L3 ❌ +remove decorador", canonL3, data, FULL);

console.log(`\n=== pares difíceis ===`);
for (const [a, b] of [["Nike", "Nike Store"], ["Fast Shop", "Fastshop"], ["Disney+", "Disney Store"], ["123milhas", "123 Milhas"], ["Casas Bahia", "casasbahia.com.br"]]) {
  const t = (c: Canon) => (c(a) === c(b) ? "=" : "≠");
  console.log(`  ${a.padEnd(12)} × ${b.padEnd(18)} L2:${t(canonL2)} ("${canonL2(a)}"/"${canonL2(b)}")   L3:${t(canonL3)}`);
}

// ---------- geração de candidatos a store_aliases ----------
const keyIndex = new Map<string, Map<Site, string>>(); // L2 -> site -> nome original
for (const s of FULL) for (const n of data[s]) {
  const k = canonL2(n);
  if (!keyIndex.has(k)) keyIndex.set(k, new Map());
  keyIndex.get(k)!.set(s, n);
}
const allKeys = [...keyIndex.keys()];

type Cand = { a: string; b: string; sitesA: Site[]; sitesB: Site[]; signal: string; score: number };
const cands = new Map<string, Cand>();
const addCand = (a: string, b: string, signal: string, score: number) => {
  const [x, y] = a < b ? [a, b] : [b, a];
  const id = `${x}|${y}`;
  if (cands.has(id)) return;
  const sA = [...keyIndex.get(x)!.keys()], sB = [...keyIndex.get(y)!.keys()];
  if (sA.length === 1 && sB.length === 1 && sA[0] === sB[0]) return; // mesmo site: não é alias
  cands.set(id, { a: x, b: y, sitesA: sA, sitesB: sB, signal, score });
};

// sinal A: mesma chave depois de tirar decorador
const byL3 = new Map<string, string[]>();
for (const k of allKeys) {
  const orig = [...keyIndex.get(k)!.values()][0];
  const l3 = canonL3(orig);
  byL3.set(l3, [...(byL3.get(l3) ?? []), k]);
}
for (const ks of byL3.values()) if (ks.length > 1)
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) addCand(ks[i], ks[j], "decorador", 1);

// sinal B: Levenshtein alto (plural, typo)
for (let i = 0; i < allKeys.length; i++) for (let j = i + 1; j < allKeys.length; j++) {
  const a = allKeys[i], b = allKeys[j];
  if (a[0] !== b[0] || Math.abs(a.length - b.length) > 2 || a.length < 5) continue;
  const r = ratio(a, b);
  if (r >= 0.88) addCand(a, b, "levenshtein", r);
}

const list = [...cands.values()].sort((x, y) => y.score - x.score);
const crossSite = list.filter((c) => !c.sitesA.every((s) => c.sitesB.includes(s)));
console.log(`\n=== candidatos a store_aliases (revisão humana) ===`);
console.log(`  chaves L2 totais:        ${allKeys.length}`);
console.log(`  pares candidatos:        ${list.length}  (decorador=${list.filter((c) => c.signal === "decorador").length} levenshtein=${list.filter((c) => c.signal === "levenshtein").length})`);
console.log(`  destes, cruzam sites:    ${crossSite.length}  ← os que importam p/ o comparador`);
console.log(`\n  amostra (revisar à mão):`);
for (const c of crossSite.slice(0, 18))
  console.log(`    [${c.signal[0]}] ${c.a.padEnd(22)} ~ ${c.b.padEnd(22)} ${c.score.toFixed(2)}  (${c.sitesA.join("/")} × ${c.sitesB.join("/")})`);

writeFileSync(new URL("../fixtures/alias-candidates.json", import.meta.url), JSON.stringify(crossSite, null, 2));
console.log(`\nfixture salvo: fixtures/alias-candidates.json (${crossSite.length} pares)`);

// ---------- métrica de produto ----------
const perSiteCount = new Map<string, number>();
for (const k of allKeys) perSiteCount.set(k, keyIndex.get(k)!.size);
const comparable = [...perSiteCount.values()].filter((v) => v >= 2).length;
console.log(`\n=== métrica de produto (4 sites, sem méliuz) ===`);
console.log(`  lojas canônicas:        ${allKeys.length}`);
console.log(`  comparáveis (≥2 portais): ${comparable}  (${((comparable / allKeys.length) * 100).toFixed(0)}%)`);
console.log(`  em 1 portal só:         ${allKeys.length - comparable}`);
