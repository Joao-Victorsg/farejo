import { readFileSync, writeFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { fetchHtml, sleep } from "./shared.js";

/**
 * POC do que o adapter méliuz precisa tirar da PÁGINA DA LOJA:
 *   nome canônico · logo · valor (% ou R$) · is_upto
 *
 * Motivo: `fixtures/meliuz-active-stores.json` tem só {slug,value,upTo,mainRate} —
 * sem nome e sem logo. E os 42 que pagam R$ estão com `value:null` (o valor só existe
 * em `btn` no crawl.jsonl). Sem nome não há `storeName` no RawOffer nem normalização.
 */
const BASE = "https://www.meliuz.com.br";
const deaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

export interface MelStore {
  slug: string;
  name: string | null;
  logoUrl: string | null;
  value: string | null; // "10%" | "R$ 25,00"
  isUpTo: boolean;
  kind: "percent" | "brl" | "none";
}

/** Nome canônico: ld+json @type=Store é o único lugar sem o prefixo "Cupom ...". */
export function parseMelStorePage(html: string, slug: string): MelStore {
  const $ = cheerio.load(html);

  let name: string | null = null;
  let logoUrl: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).contents().text());
      for (const node of j["@graph"] ?? [j]) {
        if (node["@type"] === "Store") {
          name ??= node.name ?? null;
          logoUrl ??= node.image?.url ?? (typeof node.image === "string" ? node.image : null);
        }
      }
    } catch { /* ld+json malformado */ }
  });

  // fallback de logo (ld+json pode trazer imagem de campanha, não o logo)
  const heroLogo = $(".hero-sec__logo img").attr("src") ?? null;

  const btn = $(".hero-sec__redirect-btn button").text().replace(/\s+/g, " ").trim();
  // ⚠️ `\b` NÃO funciona depois de `é` (não é word char em JS): /\bat[ée]\b/ dá false em
  // "Ativar até 10%". Tirar o acento ANTES de usar limite de palavra.
  const isUpTo = /\bate\b/i.test(deaccent(btn));
  const brl = btn.match(/R\$\s*([\d.,]+)/i);
  const pct = btn.match(/([\d.,]+)\s*%/);
  const hasCb = /de cashback/i.test(btn);

  return {
    slug,
    name,
    logoUrl: heroLogo ?? logoUrl,
    value: !hasCb ? null : brl ? `R$ ${brl[1]}` : pct ? `${pct[1]}%` : null,
    isUpTo,
    kind: !hasCb ? "none" : brl ? "brl" : pct ? "percent" : "none",
  };
}

if (process.argv.includes("--live")) {
  const active: Array<{ slug: string; value: string | null }> = JSON.parse(
    readFileSync(new URL("../fixtures/meliuz-active-stores.json", import.meta.url), "utf8")
  );
  const crawl = readFileSync(new URL("../fixtures/meliuz-crawl.jsonl", import.meta.url), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));

  // amostra estratificada: 12 em R$ (value null), 20 em %, 8 com upTo
  const brlSlugs = crawl.filter((r: any) => r.has && !r.value && /R\$/.test(r.btn ?? "")).slice(0, 12).map((r: any) => r.slug);
  const uptoSlugs = active.filter((a: any) => a.upTo).slice(0, 8).map((a) => a.slug);
  const pctSlugs = active.filter((a) => a.value && !uptoSlugs.includes(a.slug)).filter((_, i) => i % 30 === 0).slice(0, 20).map((a) => a.slug);
  const sample = [...new Set([...brlSlugs, ...uptoSlugs, ...pctSlugs])];

  console.log(`amostra: ${sample.length} lojas (${brlSlugs.length} R$, ${uptoSlugs.length} upTo, ${pctSlugs.length} %)\n`);
  const out: MelStore[] = [];
  for (const slug of sample) {
    try {
      const s = parseMelStorePage(await fetchHtml(`${BASE}/desconto/${slug}`), slug);
      out.push(s);
      process.stdout.write(s.name ? "✓" : "✗");
    } catch { process.stdout.write("x"); }
    await sleep(1300);
  }

  const named = out.filter((s) => s.name);
  const logoed = out.filter((s) => s.logoUrl);
  console.log(`\n\n=== extração ===`);
  console.log(`  nome (ld+json Store): ${named.length}/${out.length}`);
  console.log(`  logo:                 ${logoed.length}/${out.length}`);
  console.log(`  kind: percent=${out.filter((s) => s.kind === "percent").length} brl=${out.filter((s) => s.kind === "brl").length} none=${out.filter((s) => s.kind === "none").length}`);
  console.log(`  isUpTo:               ${out.filter((s) => s.isUpTo).length}`);

  console.log(`\n=== nome do ld+json × nome derivado do slug ===`);
  const fromSlug = (s: string) => s.replace(/^cupom-(de-)?(desconto-)?/, "").replace(/-/g, " ");
  let same = 0;
  const diffs: string[] = [];
  for (const s of named) {
    const a = deaccent(fromSlug(s.slug).toLowerCase()).replace(/[^a-z0-9]/g, "");
    const b = deaccent(s.name!.toLowerCase()).replace(/[^a-z0-9]/g, "");
    if (a === b) same++;
    else if (diffs.length < 8) diffs.push(`  slug→"${fromSlug(s.slug)}"  ≠  ld+json→"${s.name}"`);
  }
  console.log(`  slug bate com o nome real: ${same}/${named.length}`);
  diffs.forEach((d) => console.log(d));

  console.log(`\n=== amostra (R$ primeiro) ===`);
  out.slice(0, 10).forEach((s) => console.log(`  ${(s.name ?? "(sem nome)").padEnd(26)} ${String(s.value).padEnd(11)} ${s.kind}${s.isUpTo ? " upto" : ""}`));

  writeFileSync(new URL("../fixtures/meliuz-store-sample.json", import.meta.url), JSON.stringify(out, null, 2));
  console.log(`\nfixture salvo: fixtures/meliuz-store-sample.json`);
} else {
  const html = readFileSync(new URL("../fixtures/meliuz-loja.html", import.meta.url), "utf8");
  console.log(JSON.stringify(parseMelStorePage(html, "cupom-magazine-luiza"), null, 2));
}
