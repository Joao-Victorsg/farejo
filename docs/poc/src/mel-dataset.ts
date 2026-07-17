import { readFileSync, writeFileSync } from "node:fs";

/**
 * Reconstrói `meliuz-active-stores.json` a partir do crawl.
 *
 * O dataset antigo tinha 664 linhas mas só 622 com `value`: as 42 lojas que pagam R$ fixo
 * ficaram com `value:null` porque o valor só foi gravado em `btn`. Aqui recuperamos.
 * Continua SEM `name` — nome só existe no ld+json da página da loja (ver mel-store-page.ts).
 */
type Row = { slug: string; has?: boolean; value?: string | null; upTo?: boolean; mainRate?: string | null; btn?: string | null };

const rows: Row[] = readFileSync(new URL("../fixtures/meliuz-crawl.jsonl", import.meta.url), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

const deaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

const active = rows.filter((r) => r.has).map((r) => {
  const btn = r.btn ?? "";
  const brl = btn.match(/R\$\s*([\d.,]+)/i);
  const pct = r.value ?? btn.match(/([\d.,]+)\s*%/)?.[1]?.concat("%") ?? null;
  return {
    slug: r.slug,
    value: brl ? `R$ ${brl[1]}` : pct,
    kind: brl ? ("brl" as const) : pct ? ("percent" as const) : ("unknown" as const),
    // `\b` não funciona depois de `é` em JS — tirar acento antes do limite de palavra
    upTo: /\bate\b/i.test(deaccent(btn)),
    mainRate: r.mainRate ?? null,
  };
});

const brl = active.filter((a) => a.kind === "brl");
const pct = active.filter((a) => a.kind === "percent");
const unknown = active.filter((a) => a.kind === "unknown");

console.log(`ativas:      ${active.length}`);
console.log(`  percent:   ${pct.length}`);
console.log(`  R$ fixo:   ${brl.length}`);
console.log(`  unknown:   ${unknown.length} ${unknown.length ? "⚠️ " + unknown.slice(0, 3).map((u) => u.slug).join(", ") : "✅"}`);
console.log(`  upTo:      ${active.filter((a) => a.upTo).length}`);
console.log(`  sem valor: ${active.filter((a) => !a.value).length}`);
console.log(`\nR$ (amostra): ${brl.slice(0, 5).map((b) => `${b.slug}=${b.value}`).join(" · ")}`);

writeFileSync(new URL("../fixtures/meliuz-active-stores.json", import.meta.url), JSON.stringify(active, null, 2));
console.log(`\nfixture reescrito: fixtures/meliuz-active-stores.json (${active.length} lojas, todas com valor)`);
