import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  aliasRedirectPairs,
  checkNoLeakedSecrets,
  extractActivationLink,
  extractStoreCardSlugs,
  extractStoreSlugsFromSitemap,
  formatSmokeReport,
  hasSmokeFailure,
  isNoindex,
  loadAliasManifest,
  protectionBypassHeaders,
  readActiveSortLabel,
  readCanonicalPath,
  readCurrentPaginationPage,
  readMetaRefreshTarget,
  readInterSwitchState,
  readPaginationTotalPages,
  signInvalidation,
  storeSample,
  type SmokeCheck,
} from "./smoke-production.mjs";

describe("protectionBypassHeaders (ADR-0056)", () => {
  it("envia o bypass sem deixar cookie de sessão para trás", () => {
    expect(protectionBypassHeaders("s3cr3t")).toEqual({
      "x-vercel-protection-bypass": "s3cr3t",
      "x-vercel-set-bypass-cookie": "false",
    });
  });

  it("não envia header nenhum quando o segredo não está configurado", () => {
    expect(protectionBypassHeaders(undefined)).toEqual({});
  });
});

describe("extractStoreSlugsFromSitemap", () => {
  it("extracts every /loja/<slug> from a sitemap.xml body, in order", () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://farejo.com.br/</loc></url><url><loc>https://farejo.com.br/loja/fast-shop</loc></url><url><loc>https://farejo.com.br/loja/loja-do-mecanico</loc></url></urlset>`;
    expect(extractStoreSlugsFromSitemap(xml)).toEqual(["fast-shop", "loja-do-mecanico"]);
  });

  it("decodes percent-encoded slugs", () => {
    const xml = `<url><loc>https://farejo.com.br/loja/disney%2B</loc></url>`;
    expect(extractStoreSlugsFromSitemap(xml)).toEqual(["disney+"]);
  });

  it("returns an empty list when the sitemap has no store pages", () => {
    const xml = `<urlset><url><loc>https://farejo.com.br/</loc></url><url><loc>https://farejo.com.br/faq</loc></url></urlset>`;
    expect(extractStoreSlugsFromSitemap(xml)).toEqual([]);
  });
});

describe("extractActivationLink", () => {
  it("reads the store slug and platform id from a rendered activation href", () => {
    const html = `<a href="/go/fast-shop/meliuz" target="_blank">Ativar</a>`;
    expect(extractActivationLink(html)).toEqual({ storeSlug: "fast-shop", platformId: "meliuz" });
  });

  it("returns null when the page has no activation link (store without an active offer)", () => {
    expect(extractActivationLink("<p>Sem ofertas no momento.</p>")).toBeNull();
  });
});

describe("signInvalidation", () => {
  it("matches the HMAC the invalidation route recomputes over timestamp + body", () => {
    const secret = "a".repeat(32);
    const timestamp = "1737331200000";
    const body = JSON.stringify({ platform_id: "curation", run_id: 0, timestamp: 1737331200000 });
    const expected = createHmac("sha256", secret).update(timestamp).update(body).digest("hex");
    expect(signInvalidation(secret, timestamp, body)).toBe(expected);
  });
});

describe("checkNoLeakedSecrets", () => {
  it("passes ordinary rendered HTML with no secret-shaped substring", () => {
    const check = checkNoLeakedSecrets("GET / (sem segredo vazado)", "<html><body>Fast Shop — 8% de cashback</body></html>");
    expect(check.ok).toBe(true);
  });

  it("flags a leaked database connection string", () => {
    const check = checkNoLeakedSecrets("GET / (sem segredo vazado)", "<script>window.__ENV__={url:'postgresql://user:pw@host/db'}</script>");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("postgresql://");
  });

  it("flags a leaked FAREJO_*_DATABASE_URL env var name regardless of which one", () => {
    const check = checkNoLeakedSecrets("GET / (sem segredo vazado)", "oops FAREJO_LOGO_WRITER_DATABASE_URL leaked");
    expect(check.ok).toBe(false);
  });

  it("flags a leaked service_role mention", () => {
    const check = checkNoLeakedSecrets("GET / (sem segredo vazado)", "service_role key exposed in a stack trace");
    expect(check.ok).toBe(false);
  });
});

describe("extractStoreCardSlugs", () => {
  it("reads one slug per catalog card, in rendered order", () => {
    const html = `<article><a aria-label="Ver ofertas de Fast Shop" class="block p-5" href="/loja/fastshop">…</a></article>`
      + `<article><a aria-label="Ver ofertas de Centauro" class="block p-5" href="/loja/centauro">…</a></article>`;
    expect(extractStoreCardSlugs(html)).toEqual(["fastshop", "centauro"]);
  });

  it("ignores the JSON-escaped copy Next embeds in the RSC payload", () => {
    const html = `<a class="c" href="/loja/fastshop">x</a><script>self.__next_f.push([1,"{\\"href\\":\\"/loja/fastshop\\"}"])</script>`;
    expect(extractStoreCardSlugs(html)).toEqual(["fastshop"]);
  });

  it("returns an empty list for a catalog with no cards", () => {
    expect(extractStoreCardSlugs(`<p>O catálogo está temporariamente vazio.</p>`)).toEqual([]);
  });
});

describe("readPaginationTotalPages / readCurrentPaginationPage", () => {
  const html = `<nav aria-label="Paginação do catálogo, página 2 de 5" class="mt-10">`
    + `<a aria-label="Página 1" href="/#catalogo">1</a>`
    + `<span aria-current="page" class="size-10">2</span></nav>`;

  it("reads both numbers from the accessible name and the current-page marker", () => {
    expect(readPaginationTotalPages(html)).toBe(5);
    expect(readCurrentPaginationPage(html)).toBe(2);
  });

  it("returns null when the catalog fits in a single page (no pagination rendered)", () => {
    expect(readPaginationTotalPages(`<section id="catalogo"></section>`)).toBeNull();
    expect(readCurrentPaginationPage(`<section id="catalogo"></section>`)).toBeNull();
  });
});

describe("readActiveSortLabel", () => {
  it("reads the sort control marked aria-current=true", () => {
    const html = `<a class="rounded-full" href="/#catalogo">Mais plataformas</a>`
      + `<a aria-current="true" class="rounded-full" href="/?sort=cashback#catalogo">Maior cashback</a>`;
    expect(readActiveSortLabel(html)).toBe("Maior cashback");
  });

  it("is not fooled by the pagination's aria-current=page on the same document", () => {
    const html = `<span aria-current="page" class="size-10">2</span>`
      + `<a aria-current="true" class="rounded-full" href="/?sort=az#catalogo">A–Z</a>`;
    expect(readActiveSortLabel(html)).toBe("A–Z");
  });
});

describe("readInterSwitchState", () => {
  it("reads the SSR default as on — the toggle is client-side and always renders correntista first", () => {
    const html = `<button aria-checked="true" aria-label="Sou correntista Inter" class="relative" role="switch" type="button"></button>`;
    expect(readInterSwitchState(html)).toBe("on");
  });

  it("distinguishes an off switch from an absent one", () => {
    const off = `<button aria-checked="false" aria-label="Sou correntista Inter" class="relative" role="switch" type="button"></button>`;
    expect(readInterSwitchState(off)).toBe("off");
    expect(readInterSwitchState(`<p>Loja sem oferta do Inter</p>`)).toBe("absent");
  });
});

describe("isNoindex / readCanonicalPath", () => {
  it("reads the SEO contract a non-default sort must ship", () => {
    const html = `<meta name="robots" content="noindex, follow"/><link rel="canonical" href="https://farejo.com.br/?sort=az"/>`;
    expect(isNoindex(html)).toBe(true);
    expect(readCanonicalPath(html)).toBe("/?sort=az");
  });

  it("reports an indexable page and a bare-path canonical", () => {
    const html = `<meta name="robots" content="index, follow"/><link rel="canonical" href="/"/>`;
    expect(isNoindex(html)).toBe(false);
    expect(readCanonicalPath(html)).toBe("/");
  });

  it("returns null when the page ships no canonical at all", () => {
    expect(readCanonicalPath(`<head><title>x</title></head>`)).toBeNull();
  });
});

describe("storeSample", () => {
  // Medido contra produção: as primeiras lojas do sitemap são a cauda longa alfabética
  // ("1password", "24s", "361sport") e não têm oferta do Inter; as da home, ordenadas por
  // cobertura, têm. Amostrar só o sitemap zerava a cobertura do toggle e da hidratação.
  it("puts the home's best-covered stores ahead of the sitemap's alphabetical long tail", () => {
    const sample = storeSample(
      ["adidas", "amobeleza", "artwalk", "asics", "authenticfeet", "avon"],
      ["1password", "24s", "361sport", "4kids", "4seating", "abelharainha"],
    );
    expect(sample.slice(0, 5)).toEqual(["adidas", "amobeleza", "artwalk", "asics", "authenticfeet"]);
    expect(sample).toContain("1password");
  });

  it("keeps both sources so a sitemap-listed slug is still proven to resolve", () => {
    const sample = storeSample(["adidas"], ["1password", "24s"]);
    expect(sample).toEqual(["adidas", "1password", "24s"]);
  });

  it("does not sample the same store twice when it appears in both sources", () => {
    expect(storeSample(["adidas", "asics"], ["adidas", "24s"])).toEqual(["adidas", "asics", "24s"]);
  });

  it("still works when the home rendered no cards at all", () => {
    expect(storeSample([], ["1password", "24s"])).toEqual(["1password", "24s"]);
  });
});

describe("readMetaRefreshTarget", () => {
  // Medido contra o artefato construído: com loading.tsx, redirect()/permanentRedirect()
  // degradam para meta refresh + 200 em vez de 3xx. O smoke aceita as duas formas.
  it("reads the target of the streamed redirect Next emits once the shell is flushed", () => {
    expect(readMetaRefreshTarget(`<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/"/>`)).toBe("/");
    expect(readMetaRefreshTarget(`<meta http-equiv="refresh" content="0;url=/loja/fastshop"/>`)).toBe("/loja/fastshop");
  });

  it("returns null on a page that ships no refresh meta at all", () => {
    expect(readMetaRefreshTarget(`<meta name="robots" content="index, follow"/>`)).toBeNull();
  });
});

describe("aliasRedirectPairs", () => {
  it("derives the absorbed slug from the raw name, because stores.slug IS the L2 key", () => {
    const pairs = aliasRedirectPairs({
      version: 1,
      merges: [{ canonicalSlug: "fastshop", aliases: [{ platformId: "meliuz", rawName: "Fast Shop Brasil" }] }],
      rejects: [],
    });
    expect(pairs).toEqual([{ from: "fastshopbrasil", to: "fastshop" }]);
  });

  it("drops an alias whose raw name already normalizes to the canonical — nothing was absorbed, so no redirect row exists", () => {
    const pairs = aliasRedirectPairs({
      version: 1,
      merges: [{ canonicalSlug: "fastshop", aliases: [{ platformId: "zoom", rawName: "Fast Shop" }] }],
      rejects: [],
    });
    expect(pairs).toEqual([]);
  });

  it("deduplicates raw names from different platforms that collapse to the same absorbed slug", () => {
    const pairs = aliasRedirectPairs({
      version: 1,
      merges: [{
        canonicalSlug: "fastshop",
        aliases: [{ platformId: "meliuz", rawName: "Fast-Shop Brasil" }, { platformId: "zoom", rawName: "fast shop brasil" }],
      }],
      rejects: [],
    });
    expect(pairs).toEqual([{ from: "fastshopbrasil", to: "fastshop" }]);
  });
});

describe("loadAliasManifest", () => {
  // Guarda o caminho relativo: se ele quebrar, o check de redirect degrada para "não
  // verificado" para sempre, silenciosamente. Este teste falha em vez de deixar isso passar.
  it("reads the real curation manifest from the repo checkout", () => {
    const manifest = loadAliasManifest();
    expect(manifest).not.toBeNull();
    expect(manifest?.version).toBe(1);
    expect(Array.isArray(manifest?.merges)).toBe(true);
  });
});

describe("hasSmokeFailure", () => {
  it("fails the deploy on a real failing check", () => {
    expect(hasSmokeFailure([{ name: "GET /", ok: false, detail: "status=500" }])).toBe(true);
  });

  it("does not fail on an unverifiable check — missing production data is not a deploy regression", () => {
    expect(hasSmokeFailure([
      { name: "GET /", ok: true, detail: "status=200" },
      { name: "redirect de alias", ok: true, detail: "nenhum merge declarado", informational: true },
    ])).toBe(false);
  });
});

describe("formatSmokeReport", () => {
  it("marks every passing check and omits the latency line without activation samples", () => {
    const checks: SmokeCheck[] = [{ name: "GET /", ok: true, detail: "status=200" }];
    const text = formatSmokeReport(checks, []);
    expect(text).toContain("✅");
    expect(text).not.toContain("p95");
  });

  it("renders an unverifiable check as ℹ️ and counts it apart from the passing ones", () => {
    const checks: SmokeCheck[] = [
      { name: "GET /", ok: true, detail: "status=200" },
      { name: "redirect de alias", ok: true, detail: "nenhum merge declarado", informational: true },
    ];
    const text = formatSmokeReport(checks, []);
    expect(text).toContain("ℹ️ [smoke-production] redirect de alias");
    expect(text).toContain("1 ok · 0 falha(s) · 1 não verificado(s)");
  });

  it("marks a failing check and reports p50/p95 from the activation samples", () => {
    const checks: SmokeCheck[] = [
      { name: "GET /", ok: true, detail: "status=200" },
      { name: "GET /go/x/meliuz (cold)", ok: false, detail: "status=500" },
    ];
    const text = formatSmokeReport(checks, [120, 80, 90, 85, 95]);
    expect(text).toContain("❌");
    expect(text).toContain("p50=");
    expect(text).toContain("p95=");
    expect(text).toContain("ADR-0032");
  });
});
