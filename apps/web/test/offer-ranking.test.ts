import { describe, expect, it } from "vitest";
import type { CatalogOffer, PlatformStat } from "../src/lib/catalog";
import { NO_OFFER_SIGNALS, type OfferSignals } from "../src/lib/history";
import { effectiveSignals, formatPreviousValue, formatReward, isAnomalousPlatformCoverage, isInterCorrentistaOffer, rankOffers } from "../src/lib/offer-ranking";

type PlatformOverrides = { platformId?: string; platformName?: string };

function percentOffer(overrides: Partial<Extract<CatalogOffer["reward"], { type: "percent" }>> = {}, base: PlatformOverrides = {}): CatalogOffer {
  return {
    platformId: base.platformId ?? "meliuz",
    platformName: base.platformName ?? "Méliuz",
    freshness: "fresh",
    lastSeenAt: "2026-07-18T00:00:00.000Z",
    reward: { type: "percent", value: 5, valuePartial: null, isUpto: false, partial: null, ...NO_OFFER_SIGNALS, ...overrides },
  };
}

function fixedOffer(overrides: Partial<Extract<CatalogOffer["reward"], { type: "fixed" }>> = {}): CatalogOffer {
  return {
    platformId: "cuponomia",
    platformName: "Cuponomia",
    freshness: "fresh",
    lastSeenAt: "2026-07-18T00:00:00.000Z",
    reward: { type: "fixed", value: 20, currency: "BRL", ...NO_OFFER_SIGNALS, ...overrides },
  };
}

describe("effectiveSignals", () => {
  it("returns the primary signals for a non-Inter offer regardless of the toggle", () => {
    const offer = percentOffer({ isBoost: true, typicalValue: 4, previousValue: 4 });
    expect(effectiveSignals(offer, true)).toEqual({ isBoost: true, typicalValue: 4, previousValue: 4, validUntil: null });
    expect(effectiveSignals(offer, false)).toEqual({ isBoost: true, typicalValue: 4, previousValue: 4, validUntil: null });
  });

  it("selects the partial (não correntista) signals for Inter when the toggle is off", () => {
    const partial: OfferSignals = { isBoost: false, typicalValue: 3, previousValue: null, validUntil: null };
    const offer = percentOffer(
      { valuePartial: 4, isBoost: true, typicalValue: 8, previousValue: 6, partial },
      { platformId: "inter", platformName: "Shopping Inter" },
    );

    expect(effectiveSignals(offer, true)).toMatchObject({ isBoost: true, typicalValue: 8, previousValue: 6 });
    expect(effectiveSignals(offer, false)).toEqual(partial);
  });

  it("never falls back to the correntista baseline when the partial series is insufficient (ADR-0011)", () => {
    const offer = percentOffer(
      { valuePartial: 4, isBoost: true, typicalValue: 8, previousValue: 6, partial: null },
      { platformId: "inter", platformName: "Shopping Inter" },
    );

    // partial is null (insufficient history) — não-correntista nunca herda a leitura de correntista.
    expect(effectiveSignals(offer, false)).toEqual(NO_OFFER_SIGNALS);
  });
});

describe("formatPreviousValue", () => {
  it("returns null when there is no sustained previous value", () => {
    expect(formatPreviousValue(percentOffer())).toBeNull();
  });

  it("formats a percent previous value in pt-BR", () => {
    expect(formatPreviousValue(percentOffer({ isBoost: true, typicalValue: 5, previousValue: 7 }))).toBe("7%");
  });

  it("formats a fixed previous value as BRL currency", () => {
    expect(formatPreviousValue(fixedOffer({ isBoost: true, typicalValue: 15, previousValue: 12 }))).toBe(
      (12).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    );
  });

  it("follows the toggle for an Inter offer's previous value", () => {
    const partial: OfferSignals = { isBoost: true, typicalValue: 2, previousValue: 1, validUntil: null };
    const offer = percentOffer(
      { valuePartial: 3, isBoost: true, typicalValue: 6, previousValue: 4, partial },
      { platformId: "inter", platformName: "Shopping Inter" },
    );

    expect(formatPreviousValue(offer, true)).toBe("4%");
    expect(formatPreviousValue(offer, false)).toBe("1%");
  });
});

describe("rankOffers and formatReward — unaffected by the new signals (regression)", () => {
  it("still ranks percent above fixed and by descending value", () => {
    const offers = [fixedOffer({ value: 100 }), percentOffer({ value: 3 })];
    const ranked = rankOffers(offers);
    expect(ranked.map((offer) => offer.reward.type)).toEqual(["percent", "fixed"]);
  });

  it("still marks isInterCorrentistaOffer only for Inter offers with a partial reading", () => {
    const inter = percentOffer({ valuePartial: 2 }, { platformId: "inter" });
    const other = percentOffer({ valuePartial: 2 }, { platformId: "meliuz" });
    expect(isInterCorrentistaOffer(inter)).toBe(true);
    expect(isInterCorrentistaOffer(other)).toBe(false);
  });

  it("still preserves 'Até' formatting", () => {
    expect(formatReward(percentOffer({ isUpto: true, value: 8 }))).toBe("Até 8%");
  });
});

function statOf(overrides: Partial<PlatformStat> = {}): PlatformStat {
  return { platformId: "meliuz", platformName: "Méliuz", storeCount: 0, percentAverage: null, percentPeak: null, percentPeakIsUpto: false, ...overrides };
}

describe("isAnomalousPlatformCoverage", () => {
  it("flags every platform having zero coverage as an anomaly, not a legitimate empty state", () => {
    expect(isAnomalousPlatformCoverage([statOf({ storeCount: 0 }), statOf({ storeCount: 0 })])).toBe(true);
  });

  it("does not flag a single platform without coverage while others have real coverage", () => {
    expect(isAnomalousPlatformCoverage([statOf({ storeCount: 0 }), statOf({ storeCount: 12 })])).toBe(false);
  });

  it("treats an empty stats list as anomalous too", () => {
    expect(isAnomalousPlatformCoverage([])).toBe(true);
  });
});
