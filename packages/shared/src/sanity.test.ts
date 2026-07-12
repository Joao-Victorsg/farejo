import { describe, expect, it } from "vitest";
import { evaluateSanity, SANITY_THRESHOLDS, type SanityActual, type SanityBaseline } from "./sanity.js";

const okBaseline: SanityBaseline = { n: 5, avgOffersFound: 400, avgActiveOffers: 390 };
const okActual: SanityActual = { offersFound: 395, activeOffers: 385, parseErrors: 2, declaredTotal: null };

describe("evaluateSanity", () => {
  it("returns ok when nothing trips", () => {
    expect(evaluateSanity(okActual, okBaseline)).toEqual({ verdict: "ok", tripped: null, coldStart: false });
  });

  it("trips rule 1 when offersFound falls below 60% of the baseline average", () => {
    const actual: SanityActual = { ...okActual, offersFound: 200 }; // 200/400 = 50%
    expect(evaluateSanity(actual, okBaseline)).toMatchObject({
      verdict: "suspicious",
      tripped: "rule1_offers_found",
    });
  });

  it("does not trip rule 1 exactly at the 60% floor", () => {
    const actual: SanityActual = { ...okActual, offersFound: 240 }; // 240/400 = 60%, not < 60%
    expect(evaluateSanity(actual, okBaseline).verdict).toBe("ok");
  });

  it("trips rule 2 when activeOffers falls below 60% of the baseline average (the soft-block signal)", () => {
    const actual: SanityActual = { ...okActual, activeOffers: 200 }; // 200/390 < 60%
    expect(evaluateSanity(actual, okBaseline)).toMatchObject({
      verdict: "suspicious",
      tripped: "rule2_active_offers",
    });
  });

  it("bypasses rules 1 and 2 during cold-start (fewer than 3 ok baseline runs)", () => {
    const coldBaseline: SanityBaseline = { n: 2, avgOffersFound: 400, avgActiveOffers: 390 };
    // offersFound/activeOffers would trip rules 1 and 2 against this baseline if not cold-start.
    const actual: SanityActual = { offersFound: 1, activeOffers: 1, parseErrors: 0, declaredTotal: null };
    expect(evaluateSanity(actual, coldBaseline)).toMatchObject({ verdict: "ok", coldStart: true });
  });

  it("bypasses rules 1 and 2 for scope='bootstrap' even with a hot (3+ run) baseline", () => {
    // Mesmo baseline "quente" de okBaseline (n=5): sem scope='bootstrap' este actual
    // dispararia rule1 (10/400=2.5%) e rule2 — mas bootstrap nunca aciona 1/2.
    const actual: SanityActual = { offersFound: 10, activeOffers: 8, parseErrors: 0, declaredTotal: null, scope: "bootstrap" };
    expect(evaluateSanity(actual, okBaseline)).toMatchObject({ verdict: "ok", tripped: null });
  });

  it("still evaluates rules 3 and 4 normally for scope='bootstrap'", () => {
    const actual: SanityActual = {
      offersFound: 100,
      activeOffers: 90,
      parseErrors: 50, // 50% > 10% ceiling da regra 3
      declaredTotal: null,
      scope: "bootstrap",
    };
    expect(evaluateSanity(actual, okBaseline)).toMatchObject({ verdict: "suspicious", tripped: "rule3_parse_errors" });
  });

  it("evaluates absolute rules 3 and 4 during cold-start", () => {
    const coldBaseline: SanityBaseline = { n: 0, avgOffersFound: null, avgActiveOffers: null };
    const actual: SanityActual = { offersFound: 374, activeOffers: 363, parseErrors: 50, declaredTotal: null };
    expect(evaluateSanity(actual, coldBaseline)).toMatchObject({
      verdict: "suspicious",
      tripped: "rule3_parse_errors",
      coldStart: true,
    });
  });

  it("seeds a clean cold-start run as ok", () => {
    const coldBaseline: SanityBaseline = { n: 0, avgOffersFound: null, avgActiveOffers: null };
    const actual: SanityActual = { offersFound: 374, activeOffers: 363, parseErrors: 0, declaredTotal: 374 };
    expect(evaluateSanity(actual, coldBaseline)).toEqual({ verdict: "ok", tripped: null, coldStart: true });
  });

  it("trips rule 3 when parse_errors exceed 10% of offersFound (rawCount)", () => {
    // offersFound=300 stays above the rule-1 floor (240) so only rule 3 is exercised.
    const actual: SanityActual = { ...okActual, offersFound: 300, parseErrors: 45 };
    expect(evaluateSanity(actual, okBaseline)).toMatchObject({
      verdict: "suspicious",
      tripped: "rule3_parse_errors",
    });
  });

  it("does not trip rule 3 exactly at the 10% ceiling", () => {
    const actual: SanityActual = { ...okActual, offersFound: 300, parseErrors: 30 };
    expect(evaluateSanity(actual, okBaseline).verdict).toBe("ok");
  });

  it("does not divide by zero when offersFound is 0", () => {
    const actual: SanityActual = { ...okActual, offersFound: 0, parseErrors: 0 };
    expect(() => evaluateSanity(actual, okBaseline)).not.toThrow();
  });

  it("trips rule 4 when declaredTotal disagrees with offersFound (rawCount)", () => {
    const actual: SanityActual = { ...okActual, offersFound: 370, declaredTotal: 374 };
    expect(evaluateSanity(actual, okBaseline)).toMatchObject({
      verdict: "suspicious",
      tripped: "rule4_declared_vs_raw",
    });
  });

  it("skips rule 4 entirely when the platform has no authoritative declared total", () => {
    const actual: SanityActual = { ...okActual, offersFound: 999999, declaredTotal: null };
    expect(evaluateSanity(actual, okBaseline).tripped).not.toBe("rule4_declared_vs_raw");
  });

  it("reports the lowest-numbered rule when more than one would trip", () => {
    const actual: SanityActual = { ...okActual, offersFound: 100, parseErrors: 50, declaredTotal: 999 };
    // rule 1 (offersFound 100 < 60% of 400) AND rule 3 (50/100 > 10%) AND rule 4 (999 != 100) all apply
    expect(evaluateSanity(actual, okBaseline).tripped).toBe("rule1_offers_found");
  });

  it("exposes the documented thresholds", () => {
    expect(SANITY_THRESHOLDS).toEqual({ relativeFloor: 0.6, parseErrorCeiling: 0.1, minBaselineRuns: 3, baselineWindow: 5 });
  });
});
