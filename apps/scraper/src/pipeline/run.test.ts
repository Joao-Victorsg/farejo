import { l2Key, type RawOffer, type ScrapeResult } from "@farejo/shared";
import { fromPartial } from "@total-typescript/shoehorn";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localSupabaseClient } from "../testDb.js";
import { runPipeline } from "./run.js";

const client = localSupabaseClient();

// Plataforma de teste isolada das 5 reais, limpa em afterAll.
const PLATFORM_ID = "test-t8";

function offer(storeName: string, rewardText: string, extra: Partial<RawOffer> = {}): RawOffer {
  return { storeName, rewardText, url: `https://example.test/${storeName}`, ...extra };
}

function scrapeResult(offers: RawOffer[]): ScrapeResult {
  return { offers, scope: { kind: "full" }, rawCount: offers.length, softBlocks: 0 };
}

async function storeIdFor(storeName: string): Promise<number> {
  const { data, error } = await client.from("stores").select("id").eq("slug", l2Key(storeName)).single();
  if (error) throw error;
  return data.id;
}

describe("runPipeline (Postgres local)", () => {
  beforeAll(async () => {
    const { error } = await client
      .from("platforms")
      .upsert({ id: PLATFORM_ID, name: "Test T8", base_url: "https://t8.test" });
    if (error) throw error;
  });

  afterAll(async () => {
    const { data: aliases } = await client.from("store_aliases").select("store_id").eq("platform_id", PLATFORM_ID);
    const storeIds = [...new Set((aliases ?? []).map((a) => a.store_id).filter((id) => id != null))];

    await client.from("offer_history").delete().eq("platform_id", PLATFORM_ID);
    await client.from("offers").delete().eq("platform_id", PLATFORM_ID);
    await client.from("store_aliases").delete().eq("platform_id", PLATFORM_ID);
    if (storeIds.length > 0) await client.from("stores").delete().in("id", storeIds);
    await client.from("platforms").delete().eq("id", PLATFORM_ID);
  });

  it("creates the offer and its first history row on first sight (rule 1)", async () => {
    const runStartedAt = new Date("2026-07-01T03:00:00Z");
    const storeName = "Nike T8 Run";

    const result = await runPipeline(client, PLATFORM_ID, scrapeResult([offer(storeName, "7% Cashback")]), runStartedAt);
    expect(result).toMatchObject({ offersWritten: 1, parseErrors: 0 });

    const storeId = await storeIdFor(storeName);
    const { data: offerRow } = await client
      .from("offers")
      .select("*")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID)
      .single();
    expect(offerRow).toMatchObject({ reward_type: "percent", value: 7, is_upto: false, active: true });
    expect(new Date(offerRow!.last_seen_at).getTime()).toBe(runStartedAt.getTime());

    const { data: history } = await client
      .from("offer_history")
      .select("*")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID);
    expect(history).toHaveLength(1);
    expect(history![0]).toMatchObject({ value: 7 });
  });

  it("bumps last_seen_at without a new history row when nothing changed (rule 5)", async () => {
    const run1 = new Date("2026-07-02T03:00:00Z");
    const run2 = new Date("2026-07-02T15:00:00Z");
    const storeName = "Repeat T8 Run";
    const raw = offer(storeName, "5% Cashback");

    await runPipeline(client, PLATFORM_ID, scrapeResult([raw]), run1);
    const result2 = await runPipeline(client, PLATFORM_ID, scrapeResult([raw]), run2);
    expect(result2.parseErrors).toBe(0);

    const storeId = await storeIdFor(storeName);
    const { data: history } = await client
      .from("offer_history")
      .select("*")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID);
    expect(history).toHaveLength(1);

    const { data: offerRow } = await client
      .from("offers")
      .select("last_seen_at")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID)
      .single();
    expect(new Date(offerRow!.last_seen_at).getTime()).toBe(run2.getTime());
  });

  it("writes a new history row when the value changes (rule 2)", async () => {
    const run1 = new Date("2026-07-03T03:00:00Z");
    const run2 = new Date("2026-07-03T15:00:00Z");
    const storeName = "Change T8 Run";

    await runPipeline(client, PLATFORM_ID, scrapeResult([offer(storeName, "5% Cashback")]), run1);
    await runPipeline(client, PLATFORM_ID, scrapeResult([offer(storeName, "8% Cashback")]), run2);

    const storeId = await storeIdFor(storeName);
    const { data: history } = await client
      .from("offer_history")
      .select("value")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID)
      .order("changed_at");
    expect(history!.map((h) => h.value)).toEqual([5, 8]);

    const { data: offerRow } = await client
      .from("offers")
      .select("value")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID)
      .single();
    expect(offerRow!.value).toBe(8);
  });

  it("deactivates an offer absent from a later run of the same platform (rule 3, scope-restricted)", async () => {
    const run1 = new Date("2026-07-04T03:00:00Z");
    const run2 = new Date("2026-07-04T15:00:00Z");
    const storeName = "Vanish T8 Run";

    await runPipeline(client, PLATFORM_ID, scrapeResult([offer(storeName, "6% Cashback")]), run1);
    const result2 = await runPipeline(client, PLATFORM_ID, scrapeResult([]), run2);
    expect(result2.offersWritten).toBe(0);

    const storeId = await storeIdFor(storeName);
    const { data: offerRow } = await client
      .from("offers")
      .select("active")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID)
      .single();
    expect(offerRow!.active).toBe(false);

    const { data: history } = await client
      .from("offer_history")
      .select("value")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID)
      .order("changed_at");
    expect(history).toHaveLength(2);
    expect(history![1]!.value).toBeNull();
  });

  it("writes a new history row with the new value on reactivation (rule 4)", async () => {
    const run1 = new Date("2026-07-05T03:00:00Z");
    const run2 = new Date("2026-07-05T09:00:00Z");
    const run3 = new Date("2026-07-05T15:00:00Z");
    const storeName = "Revive T8 Run";

    await runPipeline(client, PLATFORM_ID, scrapeResult([offer(storeName, "4% Cashback")]), run1);
    await runPipeline(client, PLATFORM_ID, scrapeResult([]), run2);
    await runPipeline(client, PLATFORM_ID, scrapeResult([offer(storeName, "9% Cashback")]), run3);

    const storeId = await storeIdFor(storeName);
    const { data: offerRow } = await client
      .from("offers")
      .select("*")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID)
      .single();
    expect(offerRow).toMatchObject({ active: true, value: 9 });

    const { data: history } = await client
      .from("offer_history")
      .select("value")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID)
      .order("changed_at");
    expect(history!.map((h) => h.value)).toEqual([4, null, 9]);
  });

  it("stores value_partial as a plain number, outside the history table", async () => {
    const runStartedAt = new Date("2026-07-06T03:00:00Z");
    const storeName = "Partial T8 Run";

    await runPipeline(
      client,
      PLATFORM_ID,
      scrapeResult([offer(storeName, "7% cashback", { partialRewardText: "4.9% cashback" })]),
      runStartedAt,
    );

    const storeId = await storeIdFor(storeName);
    const { data: offerRow } = await client
      .from("offers")
      .select("value_partial")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID)
      .single();
    expect(offerRow!.value_partial).toBe(4.9);

    const { data: history } = await client
      .from("offer_history")
      .select("*")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID)
      .single();
    expect(history).not.toHaveProperty("value_partial");
  });

  it("counts a zod-invalid raw offer as a parse error instead of crashing", async () => {
    const runStartedAt = new Date("2026-07-07T03:00:00Z");
    const badOffer = fromPartial<RawOffer>({ storeName: "Missing Url T8 Run", rewardText: "5% Cashback" });
    const goodOffer = offer("Good T8 Run", "5% Cashback");

    const result = await runPipeline(client, PLATFORM_ID, scrapeResult([badOffer, goodOffer]), runStartedAt);
    expect(result).toMatchObject({ offersWritten: 1, parseErrors: 1 });

    const { data: badStore } = await client
      .from("stores")
      .select("id")
      .eq("slug", l2Key("Missing Url T8 Run"))
      .maybeSingle();
    expect(badStore).toBeNull();
  });

  it("counts an unparseable reward text as a parse error instead of crashing", async () => {
    const runStartedAt = new Date("2026-07-08T03:00:00Z");

    const result = await runPipeline(
      client,
      PLATFORM_ID,
      scrapeResult([offer("Broken Reward T8 Run", "Ofertas disponíveis"), offer("Good Reward T8 Run", "5% Cashback")]),
      runStartedAt,
    );
    expect(result).toMatchObject({ offersWritten: 1, parseErrors: 1 });
  });

  it("rejects a run scope other than full (only branch implemented in Phase 1)", async () => {
    const partialScope: ScrapeResult = {
      offers: [],
      scope: { kind: "partial", slugs: new Set() },
      rawCount: 0,
      softBlocks: 0,
    };
    await expect(runPipeline(client, PLATFORM_ID, partialScope, new Date())).rejects.toThrow();
  });
});
