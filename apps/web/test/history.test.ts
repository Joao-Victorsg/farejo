import { describe, expect, it } from "vitest";
import {
  buildHistoryChartModel,
  buildHistoryRangeOptions,
  buildResponsiveHistoryTicks,
  clipSeriesToWindow,
  composeHistorySeries,
  composeStoreHistory,
  describeHistoryAvailability,
  deriveOfferSignals,
  findHistoryRangeOption,
  groupSegmentsByRewardType,
  pickDefaultHistoryRange,
  resolveHistoryWindow,
  summarizeStoreHistory,
  summarizeSeries,
  type ComposedSeries,
  type HistoryPresentationLine,
  type HistorySegment,
  type HistoryWindow,
  type StoreHistoryRow,
} from "../src/lib/history";

const NOW = new Date("2026-07-18T12:00:00Z");
const WINDOW_START = new Date("2026-05-19T12:00:00Z"); // NOW - 60d
/** Janela servida inteira, escolhida explicitamente — não é "todo o histórico disponível". */
const SERVED_WINDOW: HistoryWindow = { start: WINDOW_START, end: NOW, days: 60, isFullAvailable: false };

function percentLine(platformId: string, platformName: string, segments: HistorySegment[]): HistoryPresentationLine {
  return { platformId, platformName, variantLabel: "", currentRewardType: "percent", series: { sufficient: true, segments } };
}

function percentSegment(from: string, to: string, value: number): HistorySegment {
  return { rewardType: "percent", from, to, value };
}

describe("composeHistorySeries", () => {
  it("uses the last event before the window as an anchor, clipped to windowStart", () => {
    const result = composeHistorySeries(
      [
        { rewardType: "percent", value: 5, changedAt: "2026-04-01T00:00:00Z" }, // anchor, before the window
        { rewardType: "percent", value: 8, changedAt: "2026-06-10T00:00:00Z" }, // inside the window
      ],
      WINDOW_START,
      NOW,
    );

    expect(result.sufficient).toBe(true);
    expect(result.segments).toEqual([
      { rewardType: "percent", from: WINDOW_START.toISOString(), to: "2026-06-10T00:00:00.000Z", value: 5 },
      { rewardType: "percent", from: "2026-06-10T00:00:00.000Z", to: NOW.toISOString(), value: 8 },
    ]);
  });

  it("is insufficient when only a single reading exists in reach of the window (no real change)", () => {
    const result = composeHistorySeries(
      [{ rewardType: "percent", value: 5, changedAt: "2026-04-01T00:00:00Z" }],
      WINDOW_START,
      NOW,
    );

    expect(result.sufficient).toBe(false);
    expect(result.segments).toEqual([{ rewardType: "percent", from: WINDOW_START.toISOString(), to: NOW.toISOString(), value: 5 }]);
  });

  it("renders deactivation as a gap, never as an interpolated or zeroed line", () => {
    const result = composeHistorySeries(
      [
        { rewardType: "percent", value: 5, changedAt: "2026-06-01T00:00:00Z" },
        { rewardType: "percent", value: null, changedAt: "2026-06-15T00:00:00Z" }, // deactivation event
      ],
      WINDOW_START,
      NOW,
    );

    expect(result.sufficient).toBe(true);
    // Only the active run is a drawable segment; the gap from 06-15 to now is simply absent.
    expect(result.segments).toEqual([{ rewardType: "percent", from: "2026-06-01T00:00:00.000Z", to: "2026-06-15T00:00:00.000Z", value: 5 }]);
  });

  it("merges consecutive events that carry the same rewardType and value (no visual or sufficiency-relevant change)", () => {
    const result = composeHistorySeries(
      [
        { rewardType: "percent", value: 5, changedAt: "2026-06-01T00:00:00Z" },
        { rewardType: "percent", value: 5, changedAt: "2026-06-10T00:00:00Z" }, // e.g. a sibling field changed, not this one
      ],
      WINDOW_START,
      NOW,
    );

    expect(result.sufficient).toBe(false);
    expect(result.segments).toEqual([{ rewardType: "percent", from: "2026-06-01T00:00:00.000Z", to: NOW.toISOString(), value: 5 }]);
  });

  it("breaks continuity across a rewardType change instead of connecting percent to fixed", () => {
    const result = composeHistorySeries(
      [
        { rewardType: "percent", value: 5, changedAt: "2026-06-01T00:00:00Z" },
        { rewardType: "fixed", value: 20, changedAt: "2026-06-10T00:00:00Z" },
      ],
      WINDOW_START,
      NOW,
    );

    const grouped = groupSegmentsByRewardType(result.segments);
    expect(grouped.percent).toEqual([{ rewardType: "percent", from: "2026-06-01T00:00:00.000Z", to: "2026-06-10T00:00:00.000Z", value: 5 }]);
    expect(grouped.fixed).toEqual([{ rewardType: "fixed", from: "2026-06-10T00:00:00.000Z", to: NOW.toISOString(), value: 20 }]);
  });

  it("is insufficient when there is no history at all in reach of the window", () => {
    const result = composeHistorySeries([], WINDOW_START, NOW);
    expect(result.sufficient).toBe(false);
    expect(result.segments).toEqual([]);
  });
});

describe("composeStoreHistory — Inter value_partial semantics", () => {
  function row(overrides: Partial<StoreHistoryRow>): StoreHistoryRow {
    return {
      platformId: "inter",
      platformName: "Shopping Inter",
      rewardType: "percent",
      value: 5,
      valuePartial: null,
      changedAt: "2026-06-01T00:00:00Z",
      ...overrides,
    };
  }

  it("has no partial series at all when value_partial has never been observed for the platform", () => {
    const rows: StoreHistoryRow[] = [
      row({ changedAt: "2026-04-01T00:00:00Z", value: 5, valuePartial: null }), // pre-migration, unknown partial
      row({ changedAt: "2026-06-01T00:00:00Z", value: 5, valuePartial: null }), // still unknown
    ];

    const [series] = composeStoreHistory(rows, NOW);
    expect(series.partial).toBeNull();
    // The primary series is unaffected by partial-only unknown periods.
    expect(series.primary.sufficient).toBe(false);
  });

  it("treats a pre-migration unknown reading as absent (not a gap) once a real partial reading exists elsewhere in the series", () => {
    const rows: StoreHistoryRow[] = [
      row({ changedAt: "2026-04-01T00:00:00Z", value: 5, valuePartial: null }), // pre-migration, unknown partial
      row({ changedAt: "2026-06-01T00:00:00Z", value: 5, valuePartial: 2 }), // first real reading, post-migration
    ];

    const [series] = composeStoreHistory(rows, NOW);
    // Only one real reading survives the "unknown" filter — no change observed yet.
    expect(series.partial?.sufficient).toBe(false);
    expect(series.partial?.segments).toEqual([{ rewardType: "percent", from: "2026-06-01T00:00:00.000Z", to: NOW.toISOString(), value: 2 }]);
  });

  it("becomes sufficient for the partial series only once a second real partial reading exists", () => {
    const rows: StoreHistoryRow[] = [
      row({ changedAt: "2026-04-01T00:00:00Z", value: 5, valuePartial: null }), // unknown, pre-migration
      row({ changedAt: "2026-06-01T00:00:00Z", value: 5, valuePartial: 2 }), // first real reading post-migration
      row({ changedAt: "2026-06-20T00:00:00Z", value: 5, valuePartial: 3 }), // second reading — a real change
    ];

    const [series] = composeStoreHistory(rows, NOW);
    expect(series.partial?.sufficient).toBe(true);
    expect(series.partial?.segments).toEqual([
      { rewardType: "percent", from: "2026-06-01T00:00:00.000Z", to: "2026-06-20T00:00:00.000Z", value: 2 },
      { rewardType: "percent", from: "2026-06-20T00:00:00.000Z", to: NOW.toISOString(), value: 3 },
    ]);
  });

  it("keeps true deactivation (value and value_partial both null) as a real gap in the partial series", () => {
    const rows: StoreHistoryRow[] = [
      row({ changedAt: "2026-05-25T00:00:00Z", value: 5, valuePartial: 2 }),
      row({ changedAt: "2026-06-10T00:00:00Z", value: null, valuePartial: null }), // real deactivation
    ];

    const [series] = composeStoreHistory(rows, NOW);
    expect(series.partial?.sufficient).toBe(true);
    expect(series.partial?.segments).toEqual([{ rewardType: "percent", from: "2026-05-25T00:00:00.000Z", to: "2026-06-10T00:00:00.000Z", value: 2 }]);
  });

  it("never exposes a partial series for a platform that has never reported value_partial", () => {
    const rows: StoreHistoryRow[] = [
      { platformId: "meliuz", platformName: "Méliuz", rewardType: "percent", value: 5, valuePartial: null, changedAt: "2026-06-01T00:00:00Z" },
      { platformId: "meliuz", platformName: "Méliuz", rewardType: "percent", value: 8, valuePartial: null, changedAt: "2026-06-15T00:00:00Z" },
    ];

    const [series] = composeStoreHistory(rows, NOW);
    expect(series.partial).toBeNull();
    expect(series.primary.sufficient).toBe(true);
  });

  it("sorts platforms by name and groups rows by platformId", () => {
    const rows: StoreHistoryRow[] = [
      { platformId: "zoom", platformName: "Zoom", rewardType: "percent", value: 5, valuePartial: null, changedAt: "2026-06-01T00:00:00Z" },
      { platformId: "zoom", platformName: "Zoom", rewardType: "percent", value: 6, valuePartial: null, changedAt: "2026-06-05T00:00:00Z" },
      { platformId: "cuponomia", platformName: "Cuponomia", rewardType: "percent", value: 4, valuePartial: null, changedAt: "2026-06-01T00:00:00Z" },
      { platformId: "cuponomia", platformName: "Cuponomia", rewardType: "percent", value: 6, valuePartial: null, changedAt: "2026-06-05T00:00:00Z" },
    ];

    const series = composeStoreHistory(rows, NOW);
    expect(series.map((entry) => entry.platformId)).toEqual(["cuponomia", "zoom"]);
  });
});

describe("summarizeSeries", () => {
  it("reports 'sendo construído' when the series is insufficient", () => {
    expect(summarizeSeries("Méliuz", { sufficient: false, segments: [] }, SERVED_WINDOW)).toBe("Méliuz: histórico sendo construído.");
  });

  it("reports a stable value when min equals max across segments", () => {
    const series = {
      sufficient: true,
      segments: [
        { rewardType: "percent" as const, from: "2026-06-01T00:00:00.000Z", to: "2026-06-10T00:00:00.000Z", value: 5 },
        { rewardType: "percent" as const, from: "2026-06-12T00:00:00.000Z", to: NOW.toISOString(), value: 5 },
      ],
    };
    expect(summarizeSeries("Zoom", series, SERVED_WINDOW)).toBe("Zoom: manteve 5% nos últimos 60 dias.");
  });

  it("reports a range and change count when values vary", () => {
    const series = {
      sufficient: true,
      segments: [
        { rewardType: "percent" as const, from: "2026-06-01T00:00:00.000Z", to: "2026-06-10T00:00:00.000Z", value: 4 },
        { rewardType: "percent" as const, from: "2026-06-10T00:00:00.000Z", to: NOW.toISOString(), value: 8 },
      ],
    };
    expect(summarizeSeries("Cuponomia", series, SERVED_WINDOW)).toBe("Cuponomia: variou entre 4% e 8% nos últimos 60 dias, com 1 mudança. Valor atual: 8%.");
  });
});

describe("summarizeStoreHistory", () => {
  it("summarizes the observed range across every platform with percent history", () => {
    const lines = [
      {
        platformId: "cuponomia",
        platformName: "Cuponomia",
        variantLabel: "",
        currentRewardType: "percent" as const,
        series: {
          sufficient: true,
          segments: [
            { rewardType: "percent" as const, from: "2026-06-01T00:00:00.000Z", to: "2026-06-10T00:00:00.000Z", value: 5.5 },
            { rewardType: "percent" as const, from: "2026-06-10T00:00:00.000Z", to: NOW.toISOString(), value: 10 },
          ],
        },
      },
      {
        platformId: "meliuz",
        platformName: "Méliuz",
        variantLabel: "",
        currentRewardType: "percent" as const,
        series: {
          sufficient: true,
          segments: [
            { rewardType: "percent" as const, from: "2026-06-04T00:00:00.000Z", to: NOW.toISOString(), value: 12.5 },
          ],
        },
      },
    ];

    expect(summarizeStoreHistory("AliExpress", "percent", lines, SERVED_WINDOW)).toBe(
      "Nos últimos 60 dias, o cashback de AliExpress variou entre 5,5% e 12,5% entre as plataformas acompanhadas. Cada linha em degraus marca quando o valor mudou; trechos sem linha indicam períodos sem dado registrado.",
    );
  });

  it("keeps exact intraday changes and inactivity gaps in the shared chart model", () => {
    const windowStart = new Date("2026-05-20T00:00:00.000Z");
    const windowEnd = new Date("2026-05-23T00:00:00.000Z");
    const model = buildHistoryChartModel(
      [
        {
          platformId: "meliuz",
          platformName: "Méliuz",
          variantLabel: "",
          currentRewardType: "percent",
          series: {
            sufficient: true,
            segments: [
              { rewardType: "percent", from: windowStart.toISOString(), to: "2026-05-21T12:30:00.000Z", value: 5 },
              { rewardType: "percent", from: "2026-05-21T12:30:00.000Z", to: "2026-05-22T00:00:00.000Z", value: 8 },
              { rewardType: "percent", from: "2026-05-22T18:00:00.000Z", to: windowEnd.toISOString(), value: 6 },
            ],
          },
        },
      ],
      "percent",
      windowStart,
      windowEnd,
    );

    expect(model.points.map((point) => point.at)).toContain(new Date("2026-05-21T12:30:00.000Z").getTime());
    expect(model.points.find((point) => point.at === new Date("2026-05-21T12:30:00.000Z").getTime())).toMatchObject({
      values: { meliuz: 8 },
      changes: ["meliuz"],
    });
    expect(model.points.find((point) => point.at === new Date("2026-05-22T00:00:00.000Z").getTime())).toMatchObject({
      values: { meliuz: null },
    });
    expect(model.points.find((point) => point.at === new Date("2026-05-21T23:59:59.999Z").getTime())).toMatchObject({
      values: { meliuz: 8 },
    });
    expect(model.points.find((point) => point.at === new Date("2026-05-22T18:00:00.000Z").getTime())).toMatchObject({
      values: { meliuz: 6 },
      changes: ["meliuz"],
    });
  });

  it("covers the complete 60-day domain with weekly ticks plus both endpoints", () => {
    const windowStart = new Date("2026-05-01T12:00:00.000Z");
    const windowEnd = new Date("2026-06-30T12:00:00.000Z");
    const model = buildHistoryChartModel(
      [
        {
          platformId: "meliuz",
          platformName: "Méliuz",
          variantLabel: "",
          currentRewardType: "percent",
          series: {
            sufficient: true,
            segments: [
              { rewardType: "percent", from: windowStart.toISOString(), to: "2026-06-01T12:00:00.000Z", value: 5 },
              { rewardType: "percent", from: "2026-06-01T12:00:00.000Z", to: windowEnd.toISOString(), value: 8 },
            ],
          },
        },
      ],
      "percent",
      windowStart,
      windowEnd,
    );

    expect(model.ticks).toHaveLength(10);
    expect(model.ticks[0]).toBe(windowStart.getTime());
    expect(model.ticks.at(-1)).toBe(windowEnd.getTime());
    expect(model.valueTicks).toEqual([5, 6, 7, 8]);
  });

  it("generates deterministic responsive dates while preserving both 60-day endpoints", () => {
    const windowStart = new Date("2026-05-01T12:00:00.000Z");
    const windowEnd = new Date("2026-06-30T12:00:00.000Z");
    const desktop = buildResponsiveHistoryTicks(windowStart, windowEnd, 1280);
    const intermediate = buildResponsiveHistoryTicks(windowStart, windowEnd, 768);
    const mobile = buildResponsiveHistoryTicks(windowStart, windowEnd, 375);

    expect(desktop).toHaveLength(10);
    expect(intermediate).toHaveLength(6);
    expect(mobile).toHaveLength(4);
    for (const ticks of [desktop, intermediate, mobile]) {
      expect(ticks[0]).toBe(windowStart.getTime());
      expect(ticks.at(-1)).toBe(windowEnd.getTime());
    }
    expect(intermediate[1]! - intermediate[0]!).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("keeps insufficient current series as collecting without adding a false line", () => {
    const windowStart = new Date("2026-05-01T00:00:00.000Z");
    const model = buildHistoryChartModel(
      [
        {
          platformId: "zoom",
          platformName: "Zoom",
          variantLabel: "",
          currentRewardType: "percent",
          series: { sufficient: false, segments: [] },
        },
        {
          platformId: "cuponomia",
          platformName: "Cuponomia",
          variantLabel: "",
          currentRewardType: "fixed",
          series: { sufficient: false, segments: [] },
        },
      ],
      "percent",
      windowStart,
      NOW,
    );

    expect(model.availableLines).toEqual([]);
    expect(model.collectingLines.map((line) => line.platformId)).toEqual(["zoom"]);
    expect(model.valueDomain).toEqual([0, 1]);
  });

  it("summarizes fixed-value history without mixing it with percentages", () => {
    const lines = [
      {
        platformId: "zoom",
        platformName: "Zoom",
        variantLabel: "",
        currentRewardType: "fixed" as const,
        series: {
          sufficient: true,
          segments: [
            { rewardType: "fixed" as const, from: "2026-06-01T00:00:00.000Z", to: "2026-06-10T00:00:00.000Z", value: 20 },
            { rewardType: "fixed" as const, from: "2026-06-10T00:00:00.000Z", to: NOW.toISOString(), value: 30 },
          ],
        },
      },
    ];

    expect(summarizeStoreHistory("Booking", "fixed", lines, SERVED_WINDOW)).toBe(
      "Nos últimos 60 dias, as ofertas de valor fixo de Booking variaram entre R$ 20,00 e R$ 30,00 entre as plataformas acompanhadas. Cada linha em degraus marca quando o valor mudou; trechos sem linha indicam períodos sem dado registrado.",
    );
  });

  it("uses singular stable wording and pt-BR decimals for constant percentage history", () => {
    const lines = [
      {
        platformId: "meliuz",
        platformName: "Méliuz",
        variantLabel: "",
        currentRewardType: "percent" as const,
        series: {
          sufficient: true,
          segments: [
            { rewardType: "percent" as const, from: "2026-06-01T00:00:00.000Z", to: NOW.toISOString(), value: 5.5 },
          ],
        },
      },
    ];

    expect(summarizeStoreHistory("AliExpress", "percent", lines, SERVED_WINDOW)).toContain("o cashback de AliExpress permaneceu em 5,5%");
    const model = buildHistoryChartModel(lines, "percent", WINDOW_START, NOW);
    expect(model.valueTicks).toHaveLength(5);
  });

  it("uses plural stable wording and BRL localization for constant fixed-value history", () => {
    const lines = [
      {
        platformId: "zoom",
        platformName: "Zoom",
        variantLabel: "",
        currentRewardType: "fixed" as const,
        series: {
          sufficient: true,
          segments: [
            { rewardType: "fixed" as const, from: "2026-06-01T00:00:00.000Z", to: NOW.toISOString(), value: 20.5 },
          ],
        },
      },
    ];

    expect(summarizeStoreHistory("Booking", "fixed", lines, SERVED_WINDOW)).toContain("as ofertas de valor fixo de Booking permaneceram em R$ 20,50");
  });
});

describe("deriveOfferSignals — boost, valor típico e valor anterior (ADR-0012/ADR-0013)", () => {
  function series(segments: ComposedSeries["segments"]): ComposedSeries {
    return { sufficient: segments.length >= 2, segments };
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const iso = (offsetDaysFromNow: number) => new Date(NOW.getTime() - offsetDaysFromNow * DAY_MS).toISOString();

  it("shows neither boost nor typical value when active coverage is below 30 days", () => {
    // Only 10 active days in the window — below the ADR-0012 minimum.
    const result = deriveOfferSignals(
      series([{ rewardType: "percent", from: iso(10), to: iso(0), value: 20 }]),
      { rewardType: "percent", value: 20 },
      null,
    );
    expect(result).toEqual({ isBoost: false, typicalValue: null, previousValue: null, validUntil: null });
  });

  it("exposes typicalValue with a sufficient baseline even when the current value does not trigger boost", () => {
    // 45 active days, unchanged at 5% the whole time. 5 < 5 * 1.3, so no boost.
    const result = deriveOfferSignals(
      series([{ rewardType: "percent", from: iso(45), to: iso(0), value: 5 }]),
      { rewardType: "percent", value: 5 },
      null,
    );
    expect(result).toEqual({ isBoost: false, typicalValue: 5, previousValue: null, validUntil: null });
  });

  it("weights the median by interval duration, so a short spike never outweighs a long-standing baseline", () => {
    // 50 days at 5%, then a 10-day spike to 50%. Naive unweighted median of {5,50} would be
    // 27.5 — the weighted median must stay 5, driven by which value covered more real time.
    const result = deriveOfferSignals(
      series([
        { rewardType: "percent", from: iso(60), to: iso(10), value: 5 },
        { rewardType: "percent", from: iso(10), to: iso(0), value: 50 },
      ]),
      { rewardType: "percent", value: 50 },
      null,
    );
    expect(result.typicalValue).toBe(5);
    expect(result.isBoost).toBe(true);
  });

  it("requires the current value to reach 130% of the typical value to qualify as boost", () => {
    const segments: ComposedSeries["segments"] = [
      { rewardType: "percent", from: iso(40), to: iso(20), value: 5 },
      { rewardType: "percent", from: iso(20), to: iso(0), value: 6.4 }, // just under 5 * 1.3 = 6.5
    ];
    const belowThreshold = deriveOfferSignals(series(segments), { rewardType: "percent", value: 6.4 }, null);
    expect(belowThreshold.isBoost).toBe(false);

    const atThreshold = deriveOfferSignals(
      series([segments[0]!, { rewardType: "percent", from: iso(20), to: iso(0), value: 6.5 }]),
      { rewardType: "percent", value: 6.5 },
      null,
    );
    expect(atThreshold.isBoost).toBe(true);
  });

  it("only counts intervals of the current rewardType toward the 30-day minimum — percent and fixed never share a baseline", () => {
    // 10 active percent days + 50 active fixed days: mixing them would clear 30 days, but
    // ADR-0012 requires the coverage to come from the SAME reward_type as the current offer.
    const result = deriveOfferSignals(
      series([
        { rewardType: "percent", from: iso(60), to: iso(50), value: 5 },
        { rewardType: "fixed", from: iso(50), to: iso(0), value: 20 },
      ]),
      { rewardType: "percent", value: 5 },
      null,
    );
    expect(result).toEqual({ isBoost: false, typicalValue: null, previousValue: null, validUntil: null });
  });

  it("prefers a valid native previous value over the historical interval, once the offer qualifies as boost", () => {
    const result = deriveOfferSignals(
      series([
        { rewardType: "percent", from: iso(40), to: iso(20), value: 5 },
        { rewardType: "percent", from: iso(20), to: iso(0), value: 10 },
      ]),
      { rewardType: "percent", value: 10 },
      { rewardType: "percent", value: 7 },
    );
    expect(result).toMatchObject({ isBoost: true, previousValue: 7 });
  });

  it("ignores a native previous value of a different rewardType and falls back to the historical interval", () => {
    const result = deriveOfferSignals(
      series([
        { rewardType: "percent", from: iso(40), to: iso(20), value: 5 },
        { rewardType: "percent", from: iso(20), to: iso(0), value: 10 },
      ]),
      { rewardType: "percent", value: 10 },
      { rewardType: "fixed", value: 20 },
    );
    expect(result).toMatchObject({ isBoost: true, previousValue: 5 });
  });

  it("falls back to null when the immediately preceding interval is separated by an inactivity gap", () => {
    const result = deriveOfferSignals(
      series([
        { rewardType: "percent", from: iso(60), to: iso(25), value: 5 }, // ends at day 25...
        { rewardType: "percent", from: iso(10), to: iso(0), value: 10 }, // ...but this starts at day 10: a gap
      ]),
      { rewardType: "percent", value: 10 },
      null,
    );
    expect(result).toMatchObject({ isBoost: true, previousValue: null });
  });

  it("falls back to null when the immediately preceding interval has a different rewardType (no gap, but not comparable)", () => {
    const result = deriveOfferSignals(
      series([
        { rewardType: "percent", from: iso(59), to: iso(24), value: 5 },
        { rewardType: "fixed", from: iso(24), to: iso(23), value: 20 }, // contiguous, but a different unit
        { rewardType: "percent", from: iso(23), to: iso(0), value: 10 },
      ]),
      { rewardType: "percent", value: 10 },
      null,
    );
    expect(result).toMatchObject({ isBoost: true, previousValue: null });
  });

  it("never shows previousValue when the offer does not qualify as boost, even with a valid native previous", () => {
    const result = deriveOfferSignals(
      series([{ rewardType: "percent", from: iso(45), to: iso(0), value: 5 }]),
      { rewardType: "percent", value: 5 },
      { rewardType: "percent", value: 4 },
    );
    expect(result).toMatchObject({ isBoost: false, previousValue: null });
  });

  it("never returns a non-null validUntil — no current source provides a verifiable expiry (ADR-0013)", () => {
    const result = deriveOfferSignals(
      series([
        { rewardType: "percent", from: iso(40), to: iso(20), value: 5 },
        { rewardType: "percent", from: iso(20), to: iso(0), value: 10 },
      ]),
      { rewardType: "percent", value: 10 },
      { rewardType: "percent", value: 7 },
    );
    expect(result.validUntil).toBeNull();
  });
});

const DAY = 24 * 60 * 60 * 1000;

function agoIso(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString();
}

/** Uma série com `changes` degraus de igual duração, espalhados nos últimos `spanDays` dias. */
function churnLine(platformId: string, changes: number, spanDays: number): HistoryPresentationLine {
  const startMs = NOW.getTime() - spanDays * DAY;
  const stepMs = (spanDays * DAY) / changes;
  return percentLine(
    platformId,
    platformId,
    Array.from({ length: changes }, (_, index) =>
      percentSegment(
        new Date(startMs + index * stepMs).toISOString(),
        new Date(startMs + (index + 1) * stepMs).toISOString(),
        5 + (index % 3),
      ),
    ),
  );
}

describe("describeHistoryAvailability", () => {
  it("measures the span from the earliest drawable segment of a new store", () => {
    const availability = describeHistoryAvailability(
      [percentLine("meliuz", "Méliuz", [percentSegment(agoIso(7), NOW.toISOString(), 12)])],
      WINDOW_START,
      NOW,
    );

    expect(availability.days).toBe(7);
    expect(availability.atServedCeiling).toBe(false);
    expect(availability.from?.toISOString()).toBe(agoIso(7));
  });

  it("flags the served ceiling when the series is anchored at the start of the read window", () => {
    const availability = describeHistoryAvailability(
      [percentLine("inter", "Shopping Inter", [percentSegment(WINDOW_START.toISOString(), NOW.toISOString(), 8)])],
      WINDOW_START,
      NOW,
    );

    expect(availability.atServedCeiling).toBe(true);
    expect(availability.days).toBe(60);
  });

  it("ignores platforms that are still collecting, even when their single reading is older", () => {
    const collecting: HistoryPresentationLine = {
      platformId: "zoom",
      platformName: "Zoom",
      variantLabel: "",
      currentRewardType: "percent",
      series: { sufficient: false, segments: [percentSegment(agoIso(50), NOW.toISOString(), 4)] },
    };
    const availability = describeHistoryAvailability(
      [collecting, percentLine("meliuz", "Méliuz", [percentSegment(agoIso(9), NOW.toISOString(), 12)])],
      WINDOW_START,
      NOW,
    );

    expect(availability.days).toBe(9);
  });

  it("reports no availability when nothing is drawable yet", () => {
    expect(describeHistoryAvailability([], WINDOW_START, NOW)).toEqual({ from: null, days: 0, atServedCeiling: false });
  });
});

describe("buildHistoryRangeOptions", () => {
  function optionsFor(days: number, atServedCeiling = false) {
    return buildHistoryRangeOptions({ from: new Date(NOW.getTime() - days * DAY), days, atServedCeiling });
  }

  it("offers no real choice for a store whose whole history is shorter than the first rung", () => {
    // O C&A ao vivo: 7 dias. "7 dias" e "tudo" ficariam a horas de distância — escolha falsa.
    const options = optionsFor(7);
    expect(options).toEqual([{ id: "tudo", days: 7, label: "Tudo · 7 dias", isFullAvailable: true }]);
  });

  it("adds a rung only once it cuts at least a quarter off the full span", () => {
    expect(optionsFor(18).map((option) => option.label)).toEqual(["7 dias", "Tudo · 18 dias"]);
    expect(optionsFor(45).map((option) => option.label)).toEqual(["7 dias", "30 dias", "Tudo · 45 dias"]);
  });

  it("never calls the served ceiling 'Tudo' — 60 days is all we read, not all the store lived", () => {
    const options = optionsFor(240, true);
    expect(options.map((option) => option.label)).toEqual(["7 dias", "30 dias", "60 dias"]);
    expect(options.some((option) => option.isFullAvailable)).toBe(false);
  });

  it("returns no options at all when there is no drawable history", () => {
    expect(buildHistoryRangeOptions({ from: null, days: 0, atServedCeiling: false })).toEqual([]);
  });
});

describe("pickDefaultHistoryRange", () => {
  const availability45 = { from: new Date(NOW.getTime() - 45 * DAY), days: 45, atServedCeiling: false };

  it("steps down to a shorter range when the store changes too often to read at full span", () => {
    const options = buildHistoryRangeOptions(availability45);
    const chosen = pickDefaultHistoryRange(options, [churnLine("meliuz", 100, 45)], availability45, NOW);
    expect(chosen?.id).toBe("7");
  });

  it("keeps the full span when the changes are sparse enough to stay legible", () => {
    const options = buildHistoryRangeOptions(availability45);
    const chosen = pickDefaultHistoryRange(options, [churnLine("meliuz", 8, 45)], availability45, NOW);
    expect(chosen?.id).toBe("tudo");
  });

  it("has no default when the store has no drawable history", () => {
    expect(pickDefaultHistoryRange([], [], { from: null, days: 0, atServedCeiling: false }, NOW)).toBeNull();
  });
});

describe("resolveHistoryWindow", () => {
  const availability = { from: new Date(NOW.getTime() - 45 * DAY), days: 45, atServedCeiling: false };

  it("pads the fitted window so the first step does not sit on the left edge", () => {
    const options = buildHistoryRangeOptions(availability);
    const window = resolveHistoryWindow(options.at(-1)!, availability, NOW);

    expect(window.isFullAvailable).toBe(true);
    expect(window.end).toEqual(NOW);
    expect(window.start.getTime()).toBe(availability.from.getTime() - 45 * DAY * 0.08);
  });

  it("honours a chosen rung exactly, with no padding", () => {
    const window = resolveHistoryWindow({ id: "7", days: 7, label: "7 dias", isFullAvailable: false }, availability, NOW);

    expect(window.isFullAvailable).toBe(false);
    expect(window.start.getTime()).toBe(NOW.getTime() - 7 * DAY);
  });
});

describe("findHistoryRangeOption", () => {
  const options = buildHistoryRangeOptions({ from: new Date(NOW.getTime() - 45 * DAY), days: 45, atServedCeiling: false });

  it("resolves a known id from the URL", () => {
    expect(findHistoryRangeOption(options, "30")?.days).toBe(30);
  });

  it("refuses an id the store cannot honour, so the caller falls back to the computed default", () => {
    // ?periodo=60 numa loja de 45 dias, ou lixo qualquer: nunca vira janela vazia.
    expect(findHistoryRangeOption(options, "60")).toBeNull();
    expect(findHistoryRangeOption(options, "365")).toBeNull();
    expect(findHistoryRangeOption(options, null)).toBeNull();
  });
});

describe("clipSeriesToWindow", () => {
  const series: ComposedSeries = {
    sufficient: true,
    segments: [
      percentSegment(agoIso(45), agoIso(30), 4),
      percentSegment(agoIso(30), agoIso(3), 9),
      percentSegment(agoIso(3), NOW.toISOString(), 14),
    ],
  };

  it("trims the segment that crosses the left edge and drops what is fully outside", () => {
    const windowStart = new Date(NOW.getTime() - 7 * DAY);
    const clipped = clipSeriesToWindow(series, windowStart, NOW);

    expect(clipped.segments).toEqual([
      percentSegment(windowStart.toISOString(), agoIso(3), 9),
      percentSegment(agoIso(3), NOW.toISOString(), 14),
    ]);
  });

  it("keeps a quiet slice sufficient — an anchored flat line is real history, not 'sendo construído'", () => {
    const clipped = clipSeriesToWindow(series, new Date(NOW.getTime() - 2 * DAY), NOW);

    expect(clipped.sufficient).toBe(true);
    expect(clipped.segments).toHaveLength(1);
    expect(clipped.segments[0]?.value).toBe(14);
  });
});

describe("buildResponsiveHistoryTicks — short windows", () => {
  it("falls back to daily marks once the window is only a few days wide", () => {
    const windowStart = new Date(NOW.getTime() - 8 * DAY);
    const ticks = buildResponsiveHistoryTicks(windowStart, NOW, 1280);

    expect(ticks[0]).toBe(windowStart.getTime());
    expect(ticks.at(-1)).toBe(NOW.getTime());
    expect(ticks[1]! - ticks[0]!).toBe(DAY);
    expect(ticks).toHaveLength(9);
  });

  it("drops an interior mark that would repeat the right-edge date on a fitted window", () => {
    const windowStart = new Date(NOW.getTime() - 8.2 * DAY);
    const ticks = buildResponsiveHistoryTicks(windowStart, NOW, 1280);
    const gaps = ticks.slice(1).map((tick, index) => tick - ticks[index]!);

    expect(ticks.at(-1)).toBe(NOW.getTime());
    expect(Math.min(...gaps)).toBeGreaterThan(DAY * 0.5);
  });
});
