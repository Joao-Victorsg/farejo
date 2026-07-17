import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Contrato que os adapters reais vão implementar — o POC valida que cada site preenche isso. */
export interface RawOffer {
  storeName: string;
  /** Texto cru do cashback, ex.: "7% Cashback", "até 5%", "Zoom te devolve 0.5% do valor" */
  rewardText: string;
  /** Valor anterior quando o site expõe boost, ex.: "era 2%" */
  previousRewardText?: string;
  /** URL da página da loja no portal (destino do redirecionamento) */
  url: string;
  logoUrl?: string;
}

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
};

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}

export function saveFixture(relPath: string, html: string): void {
  const full = fileURLToPath(new URL(`../fixtures/${relPath}`, import.meta.url));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, html, "utf8");
  console.log(`  fixture salvo: fixtures/${relPath} (${(html.length / 1024).toFixed(0)} KB)`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Resumo padronizado no fim de cada POC, para comparação entre sites. */
export function report(site: string, offers: RawOffer[]): void {
  const parseable = offers.filter((o) => /\d/.test(o.rewardText));
  const withBoost = offers.filter((o) => o.previousRewardText);
  console.log(`\n=== ${site} ===`);
  console.log(`ofertas extraídas: ${offers.length}`);
  console.log(`com valor numérico: ${parseable.length}`);
  console.log(`com boost (valor anterior): ${withBoost.length}`);
  console.log(`amostra:`);
  for (const o of offers.slice(0, 8)) {
    console.log(
      `  - ${o.storeName} | ${o.rewardText}${o.previousRewardText ? ` (antes: ${o.previousRewardText})` : ""}`
    );
  }
}
