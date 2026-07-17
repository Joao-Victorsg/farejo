import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";

/**
 * POC de assets: de onde vêm os logos das lojas, e dá para hotlinkar?
 * Testa cada CDN com e sem `Referer` do nosso domínio (hotlink protection),
 * e mede tamanho/formato/cache.
 */
const F = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), "utf8");

const samples: Array<{ site: string; url: string }> = [];

// inter
const inter = JSON.parse(F("inter-stores.api.json")).stores as any[];
samples.push({ site: "inter", url: inter.find((s) => s.imageUrl)!.imageUrl });

// zoom
const zoom = JSON.parse(F("zoom-sellers.json")) as any[];
samples.push({ site: "zoom", url: zoom.find((s) => s.logoUrls?.mediumRoundend)!.logoUrls.mediumRoundend });

// mycashback — logo real vem de data-src (lazysizes); src é sempre /img/noimage.jpg
const $m = cheerio.load(F("mycashback-all-shops.html"));
const mcImg = $m("div.card a.info img.product-logo").first();
samples.push({ site: "mycashback", url: new URL(mcImg.attr("data-src") ?? mcImg.attr("src")!, "https://www.mycashback.com.br").href });

// cuponomia
const $c = cheerio.load(F("cuponomia-loja-boost.html"));
samples.push({ site: "cuponomia", url: $c(".store_header img").first().attr("src")! });

// meliuz
const mel = JSON.parse(F("meliuz-store-sample.json")) as any[];
samples.push({ site: "meliuz", url: mel.find((s) => s.logoUrl)!.logoUrl });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function probe(url: string, referer?: string) {
  try {
    const res = await fetch(url, { headers: referer ? { "User-Agent": UA, Referer: referer } : { "User-Agent": UA } });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      type: res.headers.get("content-type") ?? "?",
      kb: (buf.length / 1024).toFixed(1),
      cors: res.headers.get("access-control-allow-origin") ?? "—",
      cache: (res.headers.get("cache-control") ?? "—").slice(0, 28),
    };
  } catch (e) {
    return { status: -1, type: (e as Error).message.slice(0, 30), kb: "0", cors: "—", cache: "—" };
  }
}

console.log("Origens dos logos:\n");
for (const s of samples) console.log(`  ${s.site.padEnd(11)} ${new URL(s.url).host}`);

console.log(`\n${"site".padEnd(11)} ${"sem Referer".padEnd(30)} ${"com Referer de terceiro".padEnd(30)}`);
console.log("-".repeat(74));
for (const s of samples) {
  const bare = await probe(s.url);
  const ref = await probe(s.url, "https://cashscout.vercel.app/");
  const fmt = (r: any) => `${r.status} ${r.type.replace("image/", "")} ${r.kb}KB`.padEnd(30);
  console.log(`${s.site.padEnd(11)} ${fmt(bare)} ${fmt(ref)}`);
}

console.log(`\nDetalhe (sem Referer):`);
for (const s of samples) {
  const r = await probe(s.url);
  console.log(`  ${s.site.padEnd(11)} cors=${String(r.cors).padEnd(4)} cache=${r.cache}`);
  console.log(`     ${s.url.slice(0, 95)}`);
}

// quantos logos únicos teríamos que hospedar, e quanto pesa?
const interN = inter.filter((s) => s.imageUrl).length;
const zoomN = zoom.filter((s) => s.logoUrls?.mediumRoundend).length;
let mcN = 0;
$m("div.card a.info img.product-logo[data-src]").each(() => {
  mcN++;
});
console.log(`\nCobertura de logo: inter=${interN}/${inter.length} zoom=${zoomN}/${zoom.length} mycashback=${mcN} meliuz=${mel.filter((s) => s.logoUrl).length}/${mel.length}`);

// peso médio: amostra de 8 logos do zoom (CDN mais previsível)
console.log(`\nPeso real (amostra de 8 logos zoom 200x200):`);
let total = 0;
for (const s of zoom.slice(0, 8)) {
  const u = s.logoUrls?.mediumRoundend;
  if (!u) continue;
  const r = await probe(u);
  total += parseFloat(r.kb);
  console.log(`  ${String(s.name).padEnd(18)} ${r.kb} KB`);
}
const avg = total / 8;
console.log(`  média: ${avg.toFixed(1)} KB`);
console.log(`\n  ~1063 lojas canônicas × ${avg.toFixed(1)} KB ≈ ${((1063 * avg) / 1024).toFixed(1)} MB`);
console.log(`  Supabase Storage free = 1 GB → cabe com folga (${(((1063 * avg) / 1024 / 1024) * 100).toFixed(2)}% do free tier)`);
