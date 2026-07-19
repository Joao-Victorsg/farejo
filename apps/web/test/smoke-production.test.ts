import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  extractActivationLink,
  extractStoreSlugsFromSitemap,
  formatSmokeReport,
  signInvalidation,
  type SmokeCheck,
} from "./smoke-production.mjs";

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

describe("formatSmokeReport", () => {
  it("marks every passing check and omits the latency line without activation samples", () => {
    const checks: SmokeCheck[] = [{ name: "GET /", ok: true, detail: "status=200" }];
    const text = formatSmokeReport(checks, []);
    expect(text).toContain("✅");
    expect(text).not.toContain("p95");
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
