import type { PlatformAdapter, ScrapeResult } from "@farejo/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exitCodeFor, runAllPlatforms } from "./runner.js";
import { localSupabaseClient } from "./testDb.js";

const client = localSupabaseClient();

const PLATFORM_OK = "test-t10-ok";
const PLATFORM_FAIL = "test-t10-fail";
const ALL_PLATFORMS = [PLATFORM_OK, PLATFORM_FAIL];

function okAdapter(): PlatformAdapter {
  return {
    platformId: PLATFORM_OK,
    async scrape(): Promise<ScrapeResult> {
      return {
        offers: [{ storeName: "Runner OK Store", rewardText: "5% Cashback", url: "https://example.test/ok" }],
        scope: { kind: "full" },
        rawCount: 1,
        softBlocks: 0,
      };
    },
  };
}

function failingAdapter(): PlatformAdapter {
  return {
    platformId: PLATFORM_FAIL,
    async scrape(): Promise<ScrapeResult> {
      throw new Error("simulated exhausted retries");
    },
  };
}

describe("runAllPlatforms (Postgres local)", () => {
  beforeAll(async () => {
    const { error } = await client
      .from("platforms")
      .upsert(ALL_PLATFORMS.map((id) => ({ id, name: id, base_url: `https://${id}.test` })));
    if (error) throw error;
  });

  afterAll(async () => {
    const { data: aliases } = await client.from("store_aliases").select("store_id").in("platform_id", ALL_PLATFORMS);
    const storeIds = [...new Set((aliases ?? []).map((a) => a.store_id).filter((id) => id != null))];

    await client.from("offer_history").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("offers").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("scrape_runs").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("store_aliases").delete().in("platform_id", ALL_PLATFORMS);
    if (storeIds.length > 0) await client.from("stores").delete().in("id", storeIds);
    await client.from("platforms").delete().in("id", ALL_PLATFORMS);
  });

  it("isolates a failing platform: writes its own failed scrape_runs row without blocking the other platform's success", async () => {
    const results = await runAllPlatforms(client, [okAdapter(), failingAdapter()]);

    const okResult = results.find((r) => r.platformId === PLATFORM_OK);
    const failResult = results.find((r) => r.platformId === PLATFORM_FAIL);
    expect(okResult).toMatchObject({ status: "ok", offersWritten: 1, error: null });
    expect(failResult).toMatchObject({ status: "failed", offersWritten: 0 });
    expect(failResult?.error).toContain("simulated exhausted retries");

    expect(exitCodeFor(results)).toBe(1);

    const { data: failRun } = await client
      .from("scrape_runs")
      .select("*")
      .eq("platform_id", PLATFORM_FAIL)
      .single();
    expect(failRun).toMatchObject({ status: "failed", offers_found: null, active_offers: null });

    const { data: okRun } = await client.from("scrape_runs").select("*").eq("platform_id", PLATFORM_OK).single();
    expect(okRun).toMatchObject({ status: "ok", offers_found: 1, active_offers: 1 });

    const { data: offerRow } = await client.from("offers").select("active").eq("platform_id", PLATFORM_OK).single();
    expect(offerRow?.active).toBe(true);
  });
});

describe("exitCodeFor", () => {
  function result(status: "ok" | "suspicious" | "failed") {
    return { platformId: `test-${status}`, status, offersWritten: 0, parseErrors: 0, error: null };
  }

  it("is 0 when every platform is ok", () => {
    expect(exitCodeFor([result("ok"), result("ok")])).toBe(0);
  });

  it("is non-zero when a platform is suspicious", () => {
    expect(exitCodeFor([result("ok"), result("suspicious")])).not.toBe(0);
  });

  it("is non-zero when a platform is failed", () => {
    expect(exitCodeFor([result("ok"), result("failed")])).not.toBe(0);
  });
});
