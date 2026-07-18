import { describe, expect, it } from "vitest";
import { composeHistorySeries, composeStoreHistory, groupSegmentsByRewardType, summarizeSeries, type StoreHistoryRow } from "../src/lib/history";

const NOW = new Date("2026-07-18T12:00:00Z");
const WINDOW_START = new Date("2026-05-19T12:00:00Z"); // NOW - 60d

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
    expect(summarizeSeries("Méliuz", { sufficient: false, segments: [] })).toBe("Méliuz: histórico sendo construído.");
  });

  it("reports a stable value when min equals max across segments", () => {
    const series = {
      sufficient: true,
      segments: [
        { rewardType: "percent" as const, from: "2026-06-01T00:00:00.000Z", to: "2026-06-10T00:00:00.000Z", value: 5 },
        { rewardType: "percent" as const, from: "2026-06-12T00:00:00.000Z", to: NOW.toISOString(), value: 5 },
      ],
    };
    expect(summarizeSeries("Zoom", series)).toBe("Zoom: manteve 5% nos últimos 60 dias.");
  });

  it("reports a range and change count when values vary", () => {
    const series = {
      sufficient: true,
      segments: [
        { rewardType: "percent" as const, from: "2026-06-01T00:00:00.000Z", to: "2026-06-10T00:00:00.000Z", value: 4 },
        { rewardType: "percent" as const, from: "2026-06-10T00:00:00.000Z", to: NOW.toISOString(), value: 8 },
      ],
    };
    expect(summarizeSeries("Cuponomia", series)).toBe("Cuponomia: variou entre 4% e 8% nos últimos 60 dias, com 1 mudança. Valor atual: 8%.");
  });
});
