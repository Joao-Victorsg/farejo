import { l2Key, type RawOffer, type ScrapeResult } from "@farejo/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localSupabaseClient } from "../testDb.js";
import { runPlatformScrape } from "./scrapeRun.js";

const client = localSupabaseClient();

// Uma plataforma de teste isolada por cenário: as regras 1/2 dependem do histórico
// completo de scrape_runs da plataforma, então cenários de baseline/cold-start
// precisam de um histórico próprio, não compartilhado entre testes.
const PLATFORM_COLDSTART = "test-t9-coldstart";
const PLATFORM_MISMATCH = "test-t9-mismatch";
const PLATFORM_COLD_DROP = "test-t9-colddrop";
const PLATFORM_BASELINE = "test-t9-baseline";
const ALL_PLATFORMS = [PLATFORM_COLDSTART, PLATFORM_MISMATCH, PLATFORM_COLD_DROP, PLATFORM_BASELINE];

function offer(storeName: string, rewardText: string): RawOffer {
  return { storeName, rewardText, url: `https://example.test/${storeName}` };
}

function scrapeResultOf(offers: RawOffer[], overrides: Partial<ScrapeResult> = {}): ScrapeResult {
  return { offers, scope: { kind: "full" }, rawCount: offers.length, softBlocks: 0, ...overrides };
}

async function storeIdFor(storeName: string): Promise<number> {
  const { data, error } = await client.from("stores").select("id").eq("slug", l2Key(storeName)).single();
  if (error) throw error;
  return data.id;
}

describe("runPlatformScrape (Postgres local)", () => {
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

  it("writes and records ok on a clean cold-start run, seeding the baseline", async () => {
    const runStartedAt = new Date("2026-07-01T03:00:00Z");
    const storeName = "Coldstart T9 Run";

    const outcome = await runPlatformScrape(
      client,
      PLATFORM_COLDSTART,
      scrapeResultOf([offer(storeName, "6% Cashback")], { declaredTotal: 1 }),
      runStartedAt,
    );
    expect(outcome).toMatchObject({ status: "ok", offersWritten: 1, parseErrors: 0, tripped: null });

    const storeId = await storeIdFor(storeName);
    const { data: offerRow } = await client
      .from("offers")
      .select("active")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_COLDSTART)
      .single();
    expect(offerRow?.active).toBe(true);

    const { data: run } = await client
      .from("scrape_runs")
      .select("*")
      .eq("platform_id", PLATFORM_COLDSTART)
      .single();
    expect(run).toMatchObject({ status: "ok", offers_found: 1, active_offers: 1, parse_errors: 0 });
    const notes = JSON.parse(run!.notes!);
    expect(notes).toMatchObject({ verdict: "ok", tripped: null, cold_start: true });
  });

  it("trips rule 4 on a declaredTotal/rawCount mismatch and does not overwrite the previous run", async () => {
    const run1 = new Date("2026-07-02T03:00:00Z");
    const run2 = new Date("2026-07-02T15:00:00Z");
    const storeName = "Mismatch T9 Run";

    await runPlatformScrape(
      client,
      PLATFORM_MISMATCH,
      scrapeResultOf([offer(storeName, "5% Cashback")], { declaredTotal: 1 }),
      run1,
    );
    const storeId = await storeIdFor(storeName);
    const { data: afterRun1 } = await client
      .from("offers")
      .select("*")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_MISMATCH)
      .single();

    const outcome2 = await runPlatformScrape(
      client,
      PLATFORM_MISMATCH,
      scrapeResultOf([offer(storeName, "9% Cashback")], { declaredTotal: 5 }), // 5 != rawCount(1)
      run2,
    );
    expect(outcome2).toMatchObject({ status: "suspicious", offersWritten: 0, tripped: "rule4_declared_vs_raw" });

    const { data: afterRun2 } = await client
      .from("offers")
      .select("*")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_MISMATCH)
      .single();
    expect(afterRun2).toEqual(afterRun1); // run2 nunca tocou a tabela offers

    const { data: run } = await client
      .from("scrape_runs")
      .select("notes")
      .eq("platform_id", PLATFORM_MISMATCH)
      .eq("status", "suspicious")
      .single();
    const notes = JSON.parse(run!.notes!);
    expect(notes).toMatchObject({ verdict: "suspicious", tripped: "rule4_declared_vs_raw" });
    expect(notes.actual).toMatchObject({ offers_found: 1, declared_total: 5 });
  });

  it("ignores a big drop while the baseline is still cold (fewer than 3 ok runs)", async () => {
    const run1 = new Date("2026-07-03T03:00:00Z");
    const run2 = new Date("2026-07-03T09:00:00Z");
    const bigRun = scrapeResultOf(Array.from({ length: 10 }, (_, i) => offer(`Cold Drop T9 Run ${i}`, "5% Cashback")));
    const smallRun = scrapeResultOf([offer("Cold Drop T9 Run 0", "5% Cashback")]); // 1 de 10 = 90% de queda

    await runPlatformScrape(client, PLATFORM_COLD_DROP, bigRun, run1);
    // baseline agora tem n=1 (< minBaselineRuns=3) → ainda cold-start, regras 1/2 não engatam
    const outcome2 = await runPlatformScrape(client, PLATFORM_COLD_DROP, smallRun, run2);
    expect(outcome2).toMatchObject({ status: "ok", offersWritten: 1 });
  });

  it("trips rule 1 once a real baseline exists and blocks the write, leaving prior offers untouched", async () => {
    const stores = Array.from({ length: 10 }, (_, i) => offer(`Baseline T9 Run ${i}`, "5% Cashback"));
    const steady = scrapeResultOf(stores);
    const dropped = scrapeResultOf(stores.slice(0, 2)); // 2 de 10 = 80% de queda

    await runPlatformScrape(client, PLATFORM_BASELINE, steady, new Date("2026-07-04T01:00:00Z"));
    await runPlatformScrape(client, PLATFORM_BASELINE, steady, new Date("2026-07-04T02:00:00Z"));
    await runPlatformScrape(client, PLATFORM_BASELINE, steady, new Date("2026-07-04T03:00:00Z"));
    // baseline agora tem n=3 runs ok, todos com offersFound=activeOffers=10

    const droppedRunStartedAt = new Date("2026-07-04T04:00:00Z");
    const outcome = await runPlatformScrape(client, PLATFORM_BASELINE, dropped, droppedRunStartedAt);
    expect(outcome.status).toBe("suspicious");
    expect(["rule1_offers_found", "rule2_active_offers"]).toContain(outcome.tripped);
    expect(outcome.offersWritten).toBe(0);

    // a loja que sumiu do run com queda continua ativa, com o last_seen_at do último run ok
    const untouchedStoreId = await storeIdFor("Baseline T9 Run 9");
    const { data: untouched } = await client
      .from("offers")
      .select("active, last_seen_at")
      .eq("store_id", untouchedStoreId)
      .eq("platform_id", PLATFORM_BASELINE)
      .single();
    expect(untouched?.active).toBe(true);
    expect(new Date(untouched!.last_seen_at).getTime()).toBe(new Date("2026-07-04T03:00:00Z").getTime());
    expect(new Date(untouched!.last_seen_at).getTime()).not.toBe(droppedRunStartedAt.getTime());
  });
});
