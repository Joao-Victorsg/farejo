import { createClient, type ScrapeResult } from "@farejo/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareOffers } from "./run.js";
import { runPlatformScrape } from "./scrapeRun.js";

vi.mock("./run.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./run.js")>(),
  prepareOffers: vi.fn(),
}));

const historicalRows = Array.from({ length: 5 }, () => ({ offers_found: 183, active_offers: 123 }));
const postChange = new Date("2026-11-08T03:05:00Z");
const preChange = new Date("2026-10-16T12:00:00Z");

function result(active: number, rawCount = 188, declaredTotal: number | null = rawCount): ScrapeResult {
  return {
    rawCount,
    ...(declaredTotal === null ? {} : { declaredTotal }),
    scope: { kind: "full" },
    softBlocks: 0,
    offers: Array.from({ length: active }, (_, i) => ({
      storeName: `Store ${i}`, rewardText: "1% de volta", url: `https://example.test/${i}`,
    })),
  };
}

function setup(recentRows: typeof historicalRows = [], parseErrors = 0) {
  const writes = vi.fn();
  const records = vi.fn();
  const baselineQueries: URLSearchParams[] = [];
  vi.mocked(prepareOffers).mockResolvedValue({
    rows: [], parseErrors, anomalies: [], parseErrorSamples: [], crawlStateRows: [],
  });
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith("/rpc/pipeline_write_offers")) {
      writes();
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/scrape_runs") && init?.method === "POST") {
      records(JSON.parse(String(init.body)));
      return Response.json({ id: 1 });
    }
    if (url.pathname.endsWith("/scrape_runs") && init?.method === "GET") {
      baselineQueries.push(url.searchParams);
      return Response.json(url.searchParams.has("started_at") ? recentRows : historicalRows);
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  return { client: createClient("https://db.example.test", "test-key"), writes, records, baselineQueries };
}

describe("Zoom verified baseline transition", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it.each([14, 15])("accepts a complete Zoom collection with %i active offers", async (active) => {
    const { client, writes, records, baselineQueries } = setup();
    const outcome = await runPlatformScrape(client, "zoom", result(active), postChange);
    expect(outcome).toMatchObject({ status: "ok", tripped: null });
    expect(writes).toHaveBeenCalledOnce();
    expect(baselineQueries[0]?.get("started_at")).toBe("gte.2026-11-07T15:00:00.000Z");
    expect(baselineQueries[0]?.get("status")).toBe("eq.ok");
    expect(JSON.parse(records.mock.calls[0]?.[0].notes)).toMatchObject({
      cold_start: false,
      baseline: { source: "zoom_verified_reference" },
    });
  });

  it.each([
    ["active offers collapse", result(8), 0, "rule2_active_offers"],
    ["empty offers", result(0), 0, "rule2_active_offers"],
    ["store coverage collapses", result(15, 100), 0, "rule1_offers_found"],
    ["parse errors", result(15), 19, "rule3_parse_errors"],
    ["an offer cannot be parsed during the transition", result(15), 1, "rule3_parse_errors"],
    ["truncated directory", result(15, 187, 188), 0, "rule4_declared_vs_raw"],
    ["missing declared total", result(15, 188, null), 0, "rule4_declared_vs_raw"],
  ] as const)("blocks writes when %s", async (_, scrape, errors, rule) => {
    const { client, writes } = setup([], errors);
    expect(await runPlatformScrape(client, "zoom", scrape, postChange))
      .toMatchObject({ status: "suspicious", tripped: rule });
    expect(writes).not.toHaveBeenCalled();
  });

  it.each([
    ["inter", "full", postChange],
    ["zoom", "active", postChange],
    ["zoom", "full", preChange],
  ] as const)("keeps the historical baseline for %s with scope %s at %s", async (platform, scope, date) => {
    const { client, writes, baselineQueries } = setup();
    expect(await runPlatformScrape(client, platform, result(15), date, scope))
      .toMatchObject({ status: "suspicious", tripped: "rule2_active_offers" });
    expect(writes).not.toHaveBeenCalled();
    expect(baselineQueries[0]?.has("started_at")).toBe(false);
  });

  it("returns to the moving average after three accepted collections", async () => {
    const rows = Array.from({ length: 3 }, () => ({ offers_found: 188, active_offers: 80 }));
    const { client, writes, records } = setup(rows);
    expect(await runPlatformScrape(client, "zoom", result(15), postChange))
      .toMatchObject({ status: "suspicious", tripped: "rule2_active_offers" });
    expect(writes).not.toHaveBeenCalled();
    expect(JSON.parse(records.mock.calls[0]?.[0].notes)).toMatchObject({
      baseline: { n: 3, avg_active: 80, source: "history", accepted_runs: 3 },
    });
  });
});
