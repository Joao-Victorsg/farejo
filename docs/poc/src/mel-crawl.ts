import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { sleep } from "./shared.js";

const BASE = "https://www.meliuz.com.br";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
};
const DELAY = 1300;
const outPath = fileURLToPath(new URL("../fixtures/meliuz-crawl.jsonl", import.meta.url));

// ---- slugs do diretório ----
const dirHtml = readFileSync(new URL("../fixtures/meliuz-desconto.html", import.meta.url), "utf8");
const slugs = [...new Set([...dirHtml.matchAll(/\/desconto\/([a-z0-9][a-z0-9-]*)/g)].map((m) => m[1]))];

// ---- retomar de onde parou ----
const done = new Set<string>();
if (existsSync(outPath)) {
  for (const line of readFileSync(outPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      done.add(JSON.parse(line).slug);
    } catch {}
  }
}
const todo = slugs.filter((s) => !done.has(s));
console.log(`Total ${slugs.length} · já feitas ${done.size} · faltam ${todo.length}`);
console.log(`Saída: ${outPath}\n`);

// ---- fetch com backoff ----
let consecutiveBlocks = 0;
async function fetchStore(url: string): Promise<{ html: string } | { gone: true } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: HEADERS, redirect: "follow" });
    } catch {
      await sleep(5000);
      continue; // erro de rede: tenta de novo
    }
    if (res.ok) {
      consecutiveBlocks = 0;
      return { html: await res.text() };
    }
    if (res.status === 404 || res.status === 410) return { gone: true };
    if (res.status === 429 || res.status === 403 || res.status === 503) {
      consecutiveBlocks++;
      if (consecutiveBlocks >= 6) throw new Error(`BLOQUEIO: ${consecutiveBlocks} respostas ${res.status} seguidas — abortando`);
      await sleep(15000 * (attempt + 1)); // 15s, 30s, 45s
      continue;
    }
    return null; // outro erro: pula
  }
  return null;
}

function parse(html: string) {
  const $ = cheerio.load(html);
  let btn = "";
  $(".hero-sec__redirect-btn button, .hero-sec button[data-redirect-url]").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (/cashback/i.test(t)) btn = t;
  });
  const mainRate = $(".hero-sec__cashback-category strong[data-main]").first().text().replace(/\s+/g, " ").trim();
  const upTo = /até/i.test(btn);
  const valMatch = btn.match(/(\d+(?:[.,]\d+)?)\s*%/) || mainRate.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const has = (/\d/.test(btn) && /cashback/i.test(btn)) || /\d/.test(mainRate);
  return {
    has,
    value: valMatch ? valMatch[1] + "%" : null,
    upTo,
    mainRate: mainRate || null,
    btn: btn || null,
  };
}

// ---- loop ----
let withCb = 0, without = 0, errors = 0, gone = 0, n = 0;
const t0 = Date.now();
for (const slug of todo) {
  let rec: Record<string, unknown>;
  try {
    const r = await fetchStore(`${BASE}/desconto/${slug}`);
    if (r && "html" in r) {
      const p = parse(r.html);
      rec = { slug, ...p };
      p.has ? withCb++ : without++;
    } else if (r && "gone" in r) {
      rec = { slug, gone: true };
      gone++;
    } else {
      rec = { slug, error: "http" };
      errors++;
    }
  } catch (e) {
    console.error(`\n${(e as Error).message}`);
    console.error(`Parado em ${n}/${todo.length}. Rode de novo para retomar.`);
    break;
  }
  appendFileSync(outPath, JSON.stringify(rec) + "\n");
  n++;
  if (n % 50 === 0) {
    const min = ((Date.now() - t0) / 60000).toFixed(1);
    const eta = (((Date.now() - t0) / n) * (todo.length - n) / 60000).toFixed(0);
    console.log(`  ${n}/${todo.length} | cashback=${withCb} sem=${without} 404=${gone} err=${errors} | ${min}min, ETA ~${eta}min`);
  }
  await sleep(DELAY);
}

console.log(`\n=== FIM (${n} processadas nesta execução) ===`);
console.log(`cashback=${withCb} · sem=${without} · 404=${gone} · erros=${errors}`);
