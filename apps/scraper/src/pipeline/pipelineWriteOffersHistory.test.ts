import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { localSupabaseClient } from "../testDb.js";
import type { PreparedOfferRow } from "./run.js";

/**
 * F3/T8 (#54, ADR-0011) — `offer_history.value_partial` e a regra de que uma mudança em
 * `value` OU `value_partial` cria um novo evento delta (não só `value`), além da
 * desativação gravar as duas modalidades como `null`.
 */
const client = localSupabaseClient();

const PLATFORM_ID = "test-t54";

function row(storeId: number, extra: Partial<PreparedOfferRow> = {}): PreparedOfferRow {
  return {
    store_id: storeId,
    reward_type: "percent",
    value: 5,
    value_partial: null,
    is_upto: false,
    raw_text: "5%",
    url: `https://example.test/${storeId}`,
    previous_reward_type: null,
    previous_value: null,
    previous_raw_text: null,
    ...extra,
  };
}

async function createStore(slug: string, name: string): Promise<number> {
  const { data, error } = await client.from("stores").insert({ slug, name }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function writeOffers(runStartedAt: Date, offers: PreparedOfferRow[]) {
  return client.rpc("pipeline_write_offers", {
    p_platform_id: PLATFORM_ID,
    p_run_started_at: runStartedAt.toISOString(),
    p_offers: offers,
  });
}

async function historyRows(storeId: number) {
  const { data, error } = await client
    .from("offer_history")
    .select("value, value_partial, changed_at")
    .eq("store_id", storeId)
    .eq("platform_id", PLATFORM_ID)
    .order("changed_at", { ascending: true });
  if (error) throw error;
  return data;
}

describe("pipeline_write_offers — offer_history.value_partial (F3/T8/#54, Postgres local)", () => {
  beforeEach(async () => {
    const { error } = await client
      .from("platforms")
      .upsert({ id: PLATFORM_ID, name: "Test T54", base_url: "https://t54.test" });
    if (error) throw error;
  });

  afterAll(async () => {
    await client.from("offer_history").delete().eq("platform_id", PLATFORM_ID);
    await client.from("offers").delete().eq("platform_id", PLATFORM_ID);
    const { data: strayStores } = await client.from("stores").select("id").like("slug", "t54-%");
    const strayIds = (strayStores ?? []).map((store) => store.id);
    if (strayIds.length > 0) await client.from("stores").delete().in("id", strayIds);
    await client.from("platforms").delete().eq("id", PLATFORM_ID);
  });

  it("regra 1: o primeiro evento já grava value_partial quando a plataforma o reporta", async () => {
    const storeId = await createStore("t54-first-seen", "First Seen T54");

    const { error } = await writeOffers(new Date("2026-07-10T03:00:00Z"), [row(storeId, { value: 10, value_partial: 2 })]);
    expect(error).toBeNull();

    const rows = await historyRows(storeId);
    expect(rows).toEqual([expect.objectContaining({ value: 10, value_partial: 2 })]);
  });

  it("regra 2: uma mudança só em value_partial (value igual) cria um novo evento delta", async () => {
    const storeId = await createStore("t54-partial-change", "Partial Change T54");
    const run1 = new Date("2026-07-10T03:00:00Z");
    const run2 = new Date("2026-07-10T15:00:00Z");

    await writeOffers(run1, [row(storeId, { value: 10, value_partial: 2 })]);
    const { error } = await writeOffers(run2, [row(storeId, { value: 10, value_partial: 3 })]);
    expect(error).toBeNull();

    const rows = await historyRows(storeId);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ value: 10, value_partial: 3 });
  });

  it("regra 5: re-run idêntico (mesmo value e value_partial) não cria linha nova em offer_history", async () => {
    const storeId = await createStore("t54-idempotent", "Idempotent T54");
    const run1 = new Date("2026-07-10T03:00:00Z");
    const run2 = new Date("2026-07-10T15:00:00Z");

    await writeOffers(run1, [row(storeId, { value: 10, value_partial: 2 })]);
    const { error } = await writeOffers(run2, [row(storeId, { value: 10, value_partial: 2 })]);
    expect(error).toBeNull();

    const rows = await historyRows(storeId);
    expect(rows).toHaveLength(1);
  });

  it("desativação por ausência grava value = null e value_partial = null juntos", async () => {
    const storeId = await createStore("t54-deactivation", "Deactivation T54");
    const run1 = new Date("2026-07-10T03:00:00Z");
    const run2 = new Date("2026-07-10T15:00:00Z");

    await writeOffers(run1, [row(storeId, { value: 10, value_partial: 2 })]);
    const { error } = await writeOffers(run2, []); // oferta ausente no run2 → desativação
    expect(error).toBeNull();

    const rows = await historyRows(storeId);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ value: null, value_partial: null });
  });
});
