import { CircuitBreakerError, NotFoundError, parseReward, RetryableError } from "@farejo/shared";
import { loadFixture } from "@farejo/test-fixtures";
import { describe, expect, it, vi } from "vitest";
import { isMeliuzDirectoryRedirect, meliuzAdapter, parseMeliuzDirectory, parseMeliuzStorePage, scrapeMeliuzSlugs } from "./meliuz.js";

const SOFT_BLOCKED_HTML = "<html><body><div class=\"home\">bem-vindo ao méliuz</div></body></html>";

function storeFixture(opts: { name?: string; image?: string; button: string }): string {
  const ldJson = JSON.stringify({
    "@graph": [
      opts.name === undefined
        ? { "@type": "SiteNavigationElement" }
        : { "@type": "Store", name: opts.name, image: { url: opts.image ?? "https://s.staticz.com.br/img/logo.png" } },
    ],
  });
  return `<html><body><div class="hero-sec">
    <script type="application/ld+json">${ldJson}</script>
    <div class="hero-sec__redirect-btn"><button>${opts.button}</button></div>
  </div></body></html>`;
}

describe("parseMeliuzStorePage", () => {
  it("extracts a percent offer with storeName/logoUrl from ld+json (Magazine Luiza, up-to)", () => {
    const outcome = parseMeliuzStorePage(loadFixture("meliuz-loja.html"), "cupom-magazine-luiza");
    expect(outcome).toMatchObject({
      slug: "cupom-magazine-luiza",
      outcome: "offer",
      offer: {
        storeName: "Magazine Luiza",
        logoUrl: "https://s.staticz.com.br/app/img/partner/filled/cupom-magazine-luiza.png",
        rewardText: "até 10% de cashback",
        url: "https://www.meliuz.com.br/desconto/cupom-magazine-luiza",
      },
    });
  });

  it("extracts a fixed BRL offer", () => {
    const html = storeFixture({ name: "Anhanguera", button: "Ativar R$ 25,00 de cashback" });
    const outcome = parseMeliuzStorePage(html, "cupom-anhaguera");
    expect(outcome).toMatchObject({
      slug: "cupom-anhaguera",
      outcome: "offer",
      offer: { storeName: "Anhanguera", rewardText: "R$ 25,00 de cashback" },
    });
  });

  it("reports no_cashback when the button offers only a coupon (no 'de cashback')", () => {
    const html = storeFixture({ name: "Amazon", button: "Ativar cupom exclusivo" });
    expect(parseMeliuzStorePage(html, "cupom-desconto-amazon")).toEqual({
      slug: "cupom-desconto-amazon",
      outcome: "no_cashback",
    });
  });

  it("reports no_cashback for the hosted BeBrasil coupon-only page even without ld+json Store", () => {
    expect(parseMeliuzStorePage(loadFixture("meliuz-bebrasil-coupon-only.sample.html"), "cupom-bebrasil")).toEqual({
      slug: "cupom-bebrasil",
      outcome: "no_cashback",
    });
  });

  it("reports soft_block when the page has no .hero-sec (presence signal missing)", () => {
    expect(parseMeliuzStorePage(SOFT_BLOCKED_HTML, "some-slug")).toEqual({
      slug: "some-slug",
      outcome: "soft_block",
    });
  });

  it("reports soft_block when .hero-sec is present but the ld+json Store name is missing", () => {
    const html = storeFixture({ name: undefined, button: "Ativar 10% de cashback" });
    expect(parseMeliuzStorePage(html, "loja-x")).toEqual({ slug: "loja-x", outcome: "soft_block" });
  });

  it("reports soft_block when the presence signal has an unknown redirect button", () => {
    const html = storeFixture({ name: "LojaX", button: "Continuar" });
    expect(parseMeliuzStorePage(html, "loja-x")).toEqual({ slug: "loja-x", outcome: "soft_block" });
  });

  it("reports soft_block when an unknown redirect button merely mentions cashback", () => {
    const html = storeFixture({ name: "LojaX", button: "Ver regras de cashback" });
    expect(parseMeliuzStorePage(html, "loja-x")).toEqual({ slug: "loja-x", outcome: "soft_block" });
  });

  it("reports soft_block when an activation CTA has no parseable reward value", () => {
    const html = storeFixture({ name: "LojaX", button: "Ativar regras de cashback" });
    expect(parseMeliuzStorePage(html, "loja-x")).toEqual({ slug: "loja-x", outcome: "soft_block" });
  });

  it("preserves 'até' verbatim from the button so downstream parseReward sees isUpto:true despite the accent", () => {
    const html = storeFixture({ name: "LojaX", button: "Ativar até 5% de cashback" });
    const outcome = parseMeliuzStorePage(html, "loja-x");
    expect(outcome).toMatchObject({ outcome: "offer", offer: { rewardText: "até 5% de cashback" } });
    expect(outcome.outcome === "offer" && parseReward(outcome.offer.rewardText)).toMatchObject({
      type: "percent",
      value: 5,
      isUpto: true,
    });
  });

  it("does not mark isUpto when the button carries no up-to marker", () => {
    const html = storeFixture({ name: "LojaX", button: "Ativar 5% de cashback" });
    const outcome = parseMeliuzStorePage(html, "loja-x");
    expect(outcome).toMatchObject({ outcome: "offer", offer: { rewardText: "5% de cashback" } });
    expect(outcome.outcome === "offer" && parseReward(outcome.offer.rewardText)).toMatchObject({
      type: "percent",
      value: 5,
      isUpto: false,
    });
  });
});

describe("isMeliuzDirectoryRedirect", () => {
  it("recognizes a redirect to the directory, but not a real store route", () => {
    expect(isMeliuzDirectoryRedirect("https://www.meliuz.com.br/desconto")).toBe(true);
    expect(isMeliuzDirectoryRedirect("https://www.meliuz.com.br/desconto/cupom-bebrasil")).toBe(false);
  });

  it("makes a redirect to the directory terminal in the real adapter", async () => {
    const response = new Response("<html><body>diretório</body></html>", { status: 200 });
    Object.defineProperty(response, "url", { value: "https://www.meliuz.com.br/desconto" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    try {
      await expect(
        meliuzAdapter.scrape({ throttleMultiplier: 1, target: { kind: "slugs", slugs: ["cupom-99-taxis"] } }),
      ).resolves.toMatchObject({
        softBlocks: 0,
        outcomes: [{ slug: "cupom-99-taxis", outcome: "not_found" }],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("parseMeliuzDirectory", () => {
  it("extrai o universo de slugs do diretório, sem usar os valores históricos do POC", () => {
    const slugs = parseMeliuzDirectory(loadFixture("meliuz-desconto.html"));

    expect(slugs).toHaveLength(2359);
    expect(slugs).toEqual(
      expect.arrayContaining([
        "cupom-desconto-amazon",
        "cupom-magazine-luiza",
        "cupom-Directv-go",
        "cupom-zupper-viagens",
      ]),
    );
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("rejeita um slug inválido em vez de persistir HTML externo sem validação", () => {
    expect(() => parseMeliuzDirectory('<a href="/desconto/loja/invalida">x</a>')).toThrow(/invalid_string/);
    expect(() => parseMeliuzDirectory('<a href="/desconto/">x</a>')).toThrow(/sem slug/);
  });
});

describe("scrapeMeliuzSlugs", () => {
  type FetchResult = string | Error;

  function deps(htmlBySlug: Record<string, FetchResult | FetchResult[]>) {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const cursor: Record<string, number> = {};
    const fetchPage = vi.fn(async (slug: string) => {
      calls.push(slug);
      const entry = htmlBySlug[slug];
      const result = Array.isArray(entry)
        ? entry[Math.min(cursor[slug] ?? 0, entry.length - 1)]!
        : (entry ?? SOFT_BLOCKED_HTML);
      if (Array.isArray(entry)) {
        const i = cursor[slug] ?? 0;
        cursor[slug] = i + 1;
      }
      if (result instanceof Error) throw result;
      return result;
    });
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    return { fetchPage, sleep, calls, sleeps };
  }

  const OFFER_HTML = storeFixture({ name: "LojaA", button: "Ativar 10% de cashback" });
  const NO_CASHBACK_HTML = storeFixture({ name: "LojaB", button: "Ativar cupom exclusivo" });

  it("consumes only instruction.target.slugs, never a directory", async () => {
    const d = deps({ a: OFFER_HTML, b: NO_CASHBACK_HTML });
    const result = await scrapeMeliuzSlugs(
      { throttleMultiplier: 1, target: { kind: "slugs", slugs: ["a", "b"] } },
      d,
    );
    expect(d.calls).toEqual(["a", "b"]);
    expect(result.offers).toHaveLength(1);
    expect(result.outcomes).toHaveLength(2);
    expect(result.scope).toEqual({ kind: "partial", slugs: new Set(["a", "b"]) });
    expect(result.rawCount).toBe(2);
  });

  it("uses an effective delay of 1.5s × throttleMultiplier between requests", async () => {
    const d = deps({ a: OFFER_HTML, b: NO_CASHBACK_HTML });
    await scrapeMeliuzSlugs({ throttleMultiplier: 2, target: { kind: "slugs", slugs: ["a", "b"] } }, d);
    expect(d.sleeps).toContain(3000);
  });

  it("retries a soft-blocked slug with 8s/16s/24s backoff and recovers if a later attempt succeeds", async () => {
    const d = deps({ a: [SOFT_BLOCKED_HTML, SOFT_BLOCKED_HTML, OFFER_HTML] });
    const result = await scrapeMeliuzSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs: ["a"] } }, d);
    expect(d.sleeps.slice(0, 2)).toEqual([8000, 16000]);
    expect(result.outcomes).toEqual([{ slug: "a", outcome: "offer", offer: expect.objectContaining({ storeName: "LojaA" }) }]);
    expect(result.softBlocks).toBe(0);
  });

  it("retries a RetryableError from fetchPage through the same soft-block backoff", async () => {
    const d = deps({ a: [new RetryableError("HTTP 405 em https://www.meliuz.com.br/desconto/a"), OFFER_HTML] });

    const result = await scrapeMeliuzSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs: ["a"] } }, d);

    expect(d.sleeps).toEqual([8000]);
    expect(result.outcomes).toEqual([{ slug: "a", outcome: "offer", offer: expect.objectContaining({ storeName: "LojaA" }) }]);
    expect(result.softBlocks).toBe(0);
  });

  it("turns a NotFoundError into a terminal not_found outcome without backoff", async () => {
    const d = deps({ a: new NotFoundError("HTTP 404 em https://www.meliuz.com.br/desconto/a") });

    const result = await scrapeMeliuzSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs: ["a"] } }, d);

    expect(d.sleeps).toEqual([]);
    expect(result).toMatchObject({
      softBlocks: 0,
      outcomes: [{ slug: "a", outcome: "not_found" }],
    });
  });

  it("reports soft_block after RetryableError exhausts the 8/16/24s backoff", async () => {
    const d = deps({ a: [new RetryableError("HTTP 405 em https://www.meliuz.com.br/desconto/a")] });

    const result = await scrapeMeliuzSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs: ["a"] } }, d);

    expect(d.sleeps).toEqual([8000, 16000, 24000]);
    expect(result.outcomes).toEqual([{ slug: "a", outcome: "soft_block" }]);
    expect(result.softBlocks).toBe(1);
  });

  it("passes exhausted RetryableErrors to the circuit breaker", async () => {
    const slugs = Array.from({ length: 12 }, (_, index) => `blocked-${index}`);
    const d = deps(Object.fromEntries(slugs.map((slug) => [slug, new RetryableError(`HTTP 405 em ${slug}`)])));

    await expect(scrapeMeliuzSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs } }, d)).rejects.toSatisfy(
      (error: unknown) => {
        if (!(error instanceof CircuitBreakerError)) return false;
        expect(error.softBlocksSoFar).toBe(12);
        expect(error.rawCountSoFar).toBe(12);
        return true;
      },
    );
  });

  it("gives up on a slug after exhausting the 8/16/24s backoff, reporting soft_block", async () => {
    const d = deps({ a: SOFT_BLOCKED_HTML });
    const result = await scrapeMeliuzSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs: ["a"] } }, d);
    expect(d.sleeps).toEqual([8000, 16000, 24000]);
    expect(result.outcomes).toEqual([{ slug: "a", outcome: "soft_block" }]);
    expect(result.softBlocks).toBe(1);
  });

  it("throws CircuitBreakerError with the correct softBlocksSoFar/rawCountSoFar after 12 consecutive soft-blocks", async () => {
    const slugs = Array.from({ length: 12 }, (_, i) => `blocked-${i}`);
    const d = deps({});
    await expect(scrapeMeliuzSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs } }, d)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(CircuitBreakerError);
        const cbe = err as CircuitBreakerError;
        expect(cbe.softBlocksSoFar).toBe(12);
        expect(cbe.rawCountSoFar).toBe(12);
        return true;
      },
    );
  });

  it("resets the consecutive soft-block counter on a non-soft-block outcome, so an interleaved recovery never trips the breaker", async () => {
    const htmlBySlug: Record<string, string> = {};
    for (let i = 0; i < 11; i++) htmlBySlug[`blocked-${i}`] = SOFT_BLOCKED_HTML;
    htmlBySlug.recovers = OFFER_HTML;
    for (let i = 11; i < 22; i++) htmlBySlug[`blocked-${i}`] = SOFT_BLOCKED_HTML;
    const slugs = [...Array.from({ length: 11 }, (_, i) => `blocked-${i}`), "recovers", ...Array.from({ length: 11 }, (_, i) => `blocked-${i + 11}`)];

    const d = deps(htmlBySlug);
    const result = await scrapeMeliuzSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs } }, d);
    expect(result.outcomes).toHaveLength(23);
    expect(result.softBlocks).toBe(22);
    expect(result.offers).toHaveLength(1);
  });

  it("throws when instruction.target.kind is not 'slugs'", async () => {
    const d = deps({});
    await expect(scrapeMeliuzSlugs({ throttleMultiplier: 1, target: { kind: "full" } }, d)).rejects.toThrow(
      /target.kind === 'slugs'/,
    );
  });
});
