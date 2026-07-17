import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sleep } from "./shared.js";
import { parseCuponomiaDirectory, parseCuponomiaStore } from "./cuponomia.js";

/**
 * Crawl completo das lojas do cuponomia (o diretório não traz valor — só a página da loja traz).
 * Substitui a extrapolação "~479 com cashback" (amostra n=30) por contagem real.
 *
 * Retomável: grava JSONL append-only e pula slugs já feitos.
 * ~799 lojas × 1,3 s ≈ 17 min.
 */
const BASE = "https://www.cuponomia.com.br";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
};
const DELAY = 1300;
const outPath = fileURLToPath(new URL("../fixtures/cuponomia-crawl.jsonl", import.meta.url));

const dirHtml = readFileSync(new URL("../fixtures/cuponomia-desconto.html", import.meta.url), "utf8");
const slugs = parseCuponomiaDirectory(dirHtml);

/**
 * Só conta como "feito" quem teve desfecho REAL (parseou, ou 404 de verdade).
 * soft404/erro são retentados: o cuponomia devolve 200 + home quando nos estrangula,
 * e tratar isso como "loja sem cashback" corromperia o dataset em silêncio.
 */
const done = new Set<string>();
if (existsSync(outPath)) {
  for (const line of readFileSync(outPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.kind || r.gone) done.add(r.slug);
    } catch {}
  }
}
const todo = slugs.filter((s) => !done.has(s));
console.log(`Total ${slugs.length} · já feitas ${done.size} · faltam ${todo.length}`);
console.log(`Saída: ${outPath}\n`);

let consecutiveBlocks = 0;
let softRetries = 0;

/**
 * Devolve o HTML só quando ele REALMENTE é a página da loja.
 * HTTP 200 sem `.store_header` = soft-block (home servida no lugar) → backoff e retenta.
 * Só depois de esgotar as tentativas é que vira `soft404` de verdade.
 */
async function fetchStore(slug: string): Promise<{ html: string } | { gone: true } | { soft: true } | null> {
  const url = `${BASE}/desconto/${slug}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: HEADERS, redirect: "follow" });
    } catch {
      await sleep(5000);
      continue;
    }
    if (res.ok) {
      const html = await res.text();
      if (html.includes("store_header")) {
        consecutiveBlocks = 0;
        return { html };
      }
      // 200 mas sem header: estrangulamento. Espera crescente e tenta de novo.
      softRetries++;
      consecutiveBlocks++;
      if (consecutiveBlocks >= 12) throw new Error(`BLOQUEIO: ${consecutiveBlocks} soft-blocks seguidos — abortando`);
      await sleep(8000 * (attempt + 1)); // 8s, 16s, 24s
      continue;
    }
    if (res.status === 404 || res.status === 410) return { gone: true };
    if (res.status === 429 || res.status === 403 || res.status === 503) {
      consecutiveBlocks++;
      if (consecutiveBlocks >= 12) throw new Error(`BLOQUEIO: ${consecutiveBlocks} respostas ${res.status} seguidas — abortando`);
      await sleep(15000 * (attempt + 1));
      continue;
    }
    return null;
  }
  return { soft: true }; // esgotou retries: provavelmente slug morto no diretório
}

let withCb = 0, without = 0, soft404 = 0, gone = 0, errors = 0, n = 0;
const t0 = Date.now();
for (const slug of todo) {
  let rec: Record<string, unknown>;
  try {
    const r = await fetchStore(slug);
    if (r && "html" in r) {
      const s = parseCuponomiaStore(r.html, slug);
      if (!s) {
        rec = { slug, soft404: true };
        soft404++;
      } else {
        rec = s as unknown as Record<string, unknown>;
        s.kind === "none" ? without++ : withCb++;
      }
    } else if (r && "gone" in r) {
      rec = { slug, gone: true };
      gone++;
    } else if (r && "soft" in r) {
      rec = { slug, soft404: true };
      soft404++;
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
    const eta = ((((Date.now() - t0) / n) * (todo.length - n)) / 60000).toFixed(0);
    console.log(`  ${n}/${todo.length} | cashback=${withCb} sem=${without} soft404=${soft404} 404=${gone} err=${errors} retries=${softRetries} | ${min}min, ETA ~${eta}min`);
  }
  await sleep(DELAY);
}

console.log(`\n=== FIM (${n} processadas nesta execução) ===`);
console.log(`cashback=${withCb} · sem=${without} · soft404=${soft404} · 404=${gone} · erros=${errors}`);
console.log(`soft-blocks retentados: ${softRetries}`);
