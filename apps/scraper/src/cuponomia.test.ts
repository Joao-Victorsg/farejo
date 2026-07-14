import { CircuitBreakerError, RetryableError } from "@farejo/shared";
import { loadFixture } from "@farejo/test-fixtures";
import { describe, expect, it, vi } from "vitest";
import { parseCuponomiaDirectory, parseCuponomiaStorePage, scrapeCuponomiaSlugs } from "./cuponomia.js";

const SOFT_BLOCKED_HTML = "<html><body><div class=\"home\">bem-vindo ao cuponomia</div></body></html>";

function upToFixture(displayed: string, actual = ""): string {
  return `<div class="store_header" data-store-name="LojaX" data-cashback-displayed="${displayed}" data-store-cashback-actual="${actual}"></div>`;
}

describe("parseCuponomiaStorePage", () => {
  it("extracts an offer with the raw actual reward text (iPlace, boost)", () => {
    const outcome = parseCuponomiaStorePage(loadFixture("cuponomia-loja-boost.html"), "iplace");
    expect(outcome).toMatchObject({
      slug: "iplace",
      outcome: "offer",
      offer: { storeName: "iPlace", rewardText: "1,5% de cashback", url: "https://www.cuponomia.com.br/desconto/iplace" },
    });
  });

  it("detects boost via del.rewardsTag-previous + has-store-boost-cashback, not header text", () => {
    const outcome = parseCuponomiaStorePage(loadFixture("cuponomia-loja-boost.html"), "iplace");
    expect(outcome.outcome).toBe("offer");
    expect(outcome.outcome === "offer" && outcome.offer.previousRewardText).toBe("era 1%");
  });

  it("extracts a fixed BRL offer (Sam's Club)", () => {
    const outcome = parseCuponomiaStorePage(loadFixture("cuponomia-loja-brl.html"), "sams-club");
    expect(outcome).toMatchObject({
      slug: "sams-club",
      outcome: "offer",
      offer: { storeName: "Sam's Club", rewardText: "R$ 8,5 de cashback" },
    });
  });

  it("reports no_cashback when data-cashback-displayed/actual are empty (123milhas)", () => {
    const outcome = parseCuponomiaStorePage(loadFixture("cuponomia-loja-exemplo.html"), "123milhas");
    expect(outcome).toEqual({ slug: "123milhas", outcome: "no_cashback" });
  });

  it("reports soft_block when the page has no .store_header (soft-404: HTTP 200 serving the home)", () => {
    expect(parseCuponomiaStorePage(SOFT_BLOCKED_HTML, "some-slug")).toEqual({
      slug: "some-slug",
      outcome: "soft_block",
    });
  });

  it("normalizes 'até X%' in data-cashback-displayed before building the fallback rewardText (is_upto correct, no duplicated prefix)", () => {
    const outcome = parseCuponomiaStorePage(upToFixture("até 4%"), "loja-x");
    expect(outcome).toMatchObject({ outcome: "offer", offer: { rewardText: "até 4% de cashback" } });
  });

  it("does not prefix 'até' when displayed carries no up-to marker", () => {
    const outcome = parseCuponomiaStorePage(upToFixture("4%"), "loja-x");
    expect(outcome).toMatchObject({ outcome: "offer", offer: { rewardText: "4% de cashback" } });
  });
});

describe("parseCuponomiaDirectory", () => {
  it("extrai o universo de slugs do diretório, sem inferir cashback", () => {
    const slugs = parseCuponomiaDirectory(loadFixture("cuponomia-desconto.html"));

    expect(slugs).toHaveLength(799);
    expect(slugs).toEqual(expect.arrayContaining(["123-milhas", "iplace", "zupper-viagens"]));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("rejeita um slug inválido em vez de persistir HTML externo sem validação", () => {
    expect(() => parseCuponomiaDirectory('<ul class="list-letter"><li><a href="/desconto/loja/invalida">x</a></li></ul>'))
      .toThrow(/invalid_string/);
    expect(() => parseCuponomiaDirectory('<ul class="list-letter"><li><a href="/desconto/">x</a></li></ul>')).toThrow(
      /sem slug/,
    );
  });
});

describe("scrapeCuponomiaSlugs", () => {
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

  it("consumes only instruction.target.slugs, never a directory", async () => {
    const d = deps({
      a: loadFixture("cuponomia-loja-boost.html"),
      b: loadFixture("cuponomia-loja-exemplo.html"),
    });
    const result = await scrapeCuponomiaSlugs(
      { throttleMultiplier: 1, target: { kind: "slugs", slugs: ["a", "b"] } },
      d,
    );
    expect(d.calls).toEqual(["a", "b"]);
    expect(result.offers).toHaveLength(1);
    expect(result.outcomes).toHaveLength(2);
    expect(result.scope).toEqual({ kind: "partial", slugs: new Set(["a", "b"]) });
    expect(result.rawCount).toBe(2);
  });

  it("uses an effective delay of 1.3s × throttleMultiplier between requests", async () => {
    const d = deps({ a: loadFixture("cuponomia-loja-boost.html"), b: loadFixture("cuponomia-loja-exemplo.html") });
    await scrapeCuponomiaSlugs({ throttleMultiplier: 2, target: { kind: "slugs", slugs: ["a", "b"] } }, d);
    expect(d.sleeps).toContain(2600);
  });

  it("retries a soft-blocked slug with 8s/16s/24s backoff and recovers if a later attempt succeeds", async () => {
    const d = deps({ a: [SOFT_BLOCKED_HTML, SOFT_BLOCKED_HTML, loadFixture("cuponomia-loja-boost.html")] });
    const result = await scrapeCuponomiaSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs: ["a"] } }, d);
    expect(d.sleeps.slice(0, 2)).toEqual([8000, 16000]);
    expect(result.outcomes).toEqual([{ slug: "a", outcome: "offer", offer: expect.objectContaining({ storeName: "iPlace" }) }]);
    expect(result.softBlocks).toBe(0);
  });

  it("retries a RetryableError from fetchPage through the same soft-block backoff", async () => {
    const d = deps({ a: [new RetryableError("HTTP 405 em https://www.cuponomia.com.br/desconto/a"), loadFixture("cuponomia-loja-boost.html")] });

    const result = await scrapeCuponomiaSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs: ["a"] } }, d);

    expect(d.sleeps).toEqual([8000]);
    expect(result.outcomes).toEqual([{ slug: "a", outcome: "offer", offer: expect.objectContaining({ storeName: "iPlace" }) }]);
    expect(result.softBlocks).toBe(0);
  });

  it("reports soft_block after RetryableError exhausts the 8/16/24s backoff", async () => {
    const d = deps({ a: [new RetryableError("HTTP 405 em https://www.cuponomia.com.br/desconto/a")] });

    const result = await scrapeCuponomiaSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs: ["a"] } }, d);

    expect(d.sleeps).toEqual([8000, 16000, 24000]);
    expect(result.outcomes).toEqual([{ slug: "a", outcome: "soft_block" }]);
    expect(result.softBlocks).toBe(1);
  });

  it("passes exhausted RetryableErrors to the circuit breaker", async () => {
    const slugs = Array.from({ length: 12 }, (_, index) => `blocked-${index}`);
    const d = deps(Object.fromEntries(slugs.map((slug) => [slug, new RetryableError(`HTTP 405 em ${slug}`)])));

    await expect(scrapeCuponomiaSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs } }, d)).rejects.toSatisfy(
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
    const result = await scrapeCuponomiaSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs: ["a"] } }, d);
    expect(d.sleeps).toEqual([8000, 16000, 24000]);
    expect(result.outcomes).toEqual([{ slug: "a", outcome: "soft_block" }]);
    expect(result.softBlocks).toBe(1);
  });

  it("throws CircuitBreakerError with the correct softBlocksSoFar/rawCountSoFar after 12 consecutive soft-blocks", async () => {
    const slugs = Array.from({ length: 12 }, (_, i) => `blocked-${i}`);
    const d = deps({});
    await expect(scrapeCuponomiaSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs } }, d)).rejects.toSatisfy(
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
    htmlBySlug.recovers = loadFixture("cuponomia-loja-boost.html");
    for (let i = 11; i < 22; i++) htmlBySlug[`blocked-${i}`] = SOFT_BLOCKED_HTML;
    const slugs = [...Array.from({ length: 11 }, (_, i) => `blocked-${i}`), "recovers", ...Array.from({ length: 11 }, (_, i) => `blocked-${i + 11}`)];

    const d = deps(htmlBySlug);
    const result = await scrapeCuponomiaSlugs({ throttleMultiplier: 1, target: { kind: "slugs", slugs } }, d);
    expect(result.outcomes).toHaveLength(23);
    expect(result.softBlocks).toBe(22);
    expect(result.offers).toHaveLength(1);
  });
});
