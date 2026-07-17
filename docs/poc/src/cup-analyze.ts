import { readFileSync, writeFileSync } from "node:fs";
import { parseDisplayed, type CuponomiaStore } from "./cuponomia.js";

type Row = Partial<CuponomiaStore> & { slug: string; soft404?: boolean; gone?: boolean; error?: string };

const raw: Row[] = readFileSync(new URL("../fixtures/cuponomia-crawl.jsonl", import.meta.url), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

/**
 * Linhas gravadas antes do fix de `até X%` têm `value:null`/`kind` errado.
 * `displayed` é a fonte da verdade — recomputa em vez de re-crawlear.
 * Se um slug foi retentado, a última linha vence.
 */
const byslug = new Map<string, Row>();
for (const r of raw) {
  const prev = byslug.get(r.slug);
  if (prev && (prev.kind || prev.gone) && !(r.kind || r.gone)) continue; // não regride
  byslug.set(r.slug, r);
}
const rows = [...byslug.values()].map((r) => {
  if (r.displayed == null) return r;
  const p = parseDisplayed(r.displayed);
  return { ...r, kind: p.kind, value: p.value, upTo: r.upTo || p.upTo };
});
console.log(`linhas no jsonl: ${raw.length} · slugs únicos: ${rows.length}\n`);

const ok = rows.filter((r) => r.kind);
const active = ok.filter((r) => r.kind !== "none");
const pct = active.filter((r) => r.kind === "percent");
const brl = active.filter((r) => r.kind === "brl");

console.log(`=== crawl cuponomia: ${rows.length} slugs ===`);
console.log(`  parseadas:   ${ok.length}`);
console.log(`  soft-404:    ${rows.filter((r) => r.soft404).length}`);
console.log(`  404/410:     ${rows.filter((r) => r.gone).length}`);
console.log(`  erro http:   ${rows.filter((r) => r.error).length}`);
console.log(`\n  COM cashback: ${active.length}  (${((active.length / ok.length) * 100).toFixed(1)}% das parseadas)`);
console.log(`  sem cashback: ${ok.length - active.length}`);
console.log(`    percent:    ${pct.length}`);
console.log(`    R$ fixo:    ${brl.length}`);
console.log(`  upTo=true:    ${active.filter((r) => r.upTo).length}`);
console.log(`  boost:        ${active.filter((r) => r.boost).length}`);
console.log(`  com previous: ${active.filter((r) => r.previous).length}`);
console.log(`  sem logo:     ${active.filter((r) => !r.logoUrl).length}`);

// PENDÊNCIA: `actual` prefixa "até" quando upTo=true?
const upto = active.filter((r) => r.upTo);
console.log(`\n=== upTo × texto de 'actual' ===`);
if (!upto.length) console.log(`  nenhuma loja com up-to=true no diretório inteiro → pendência segue aberta`);
else {
  const deaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const prefixed = upto.filter((r) => /\bate\b/i.test(deaccent(r.actual ?? "")));
  console.log(`  upTo=true: ${upto.length} · com "até" no actual: ${prefixed.length}`);
  upto.slice(0, 6).forEach((r) => console.log(`    ${r.slug}: displayed="${r.displayed}" actual="${r.actual}"`));
}

// coerência: rate × value
console.log(`\n=== data-conversion-rate confere com o displayed? ===`);
let mism = 0, noRate = 0;
for (const r of active) {
  if (r.rate == null) { noRate++; continue; }
  const expect = r.kind === "percent" ? r.rate * 100 : r.rate;
  if (Math.abs(expect - (r.value ?? 0)) > 0.011) {
    if (mism < 6) console.log(`    ${r.slug}: displayed="${r.displayed}" value=${r.value} rate=${r.rate} → esperado ${expect.toFixed(3)}`);
    mism++;
  }
}
console.log(`  sem aside.rewardsTag (rate null): ${noRate}`);
console.log(`  divergências rate×displayed:      ${mism}`);

// boost
console.log(`\n=== boost (del.rewardsTag-previous) ===`);
active.filter((r) => r.previous).slice(0, 8).forEach((r) => console.log(`    ${r.name}: ${r.displayed}  ${r.previous}  boostClass=${r.boost}`));
const boostNoPrev = active.filter((r) => r.boost && !r.previous).length;
const prevNoBoost = active.filter((r) => !r.boost && r.previous).length;
console.log(`  classe boost sem <del>: ${boostNoPrev} · <del> sem classe boost: ${prevNoBoost}`);

// distribuição
const buckets: Record<string, number> = {};
for (const r of pct) {
  const v = r.value ?? 0;
  const b = v < 1 ? "<1%" : v < 3 ? "1-3%" : v < 5 ? "3-5%" : v < 10 ? "5-10%" : "10%+";
  buckets[b] = (buckets[b] ?? 0) + 1;
}
console.log(`\n=== distribuição % ===`);
console.log(`  ${JSON.stringify(buckets)}`);
const vals = pct.map((r) => r.value).filter((v): v is number => v != null).sort((a, b) => a - b);
console.log(`  min=${vals[0]}% max=${vals.at(-1)}% mediana=${vals[Math.floor(vals.length / 2)]}%`);
const semValor = active.filter((r) => r.value == null);
console.log(`  ativas sem valor parseado: ${semValor.length} ${semValor.length ? "⚠️ " + semValor.slice(0, 4).map((r) => `${r.slug}="${r.displayed}"`).join(" ") : "✅"}`);
console.log(`\n=== R$ fixo ===`);
brl.forEach((r) => console.log(`    ${r.name}: ${r.displayed}`));

const dataset = active.map((r) => ({ slug: r.slug, name: r.name, kind: r.kind, value: r.value, upTo: r.upTo, previous: r.previous ?? null, logoUrl: r.logoUrl }));
writeFileSync(new URL("../fixtures/cuponomia-active-stores.json", import.meta.url), JSON.stringify(dataset, null, 2));
console.log(`\nfixture salvo: fixtures/cuponomia-active-stores.json (${dataset.length} lojas)`);
