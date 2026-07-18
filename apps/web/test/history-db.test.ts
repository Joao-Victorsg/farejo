import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const fixturePrefix = "issue54-history-";
const client = new Client({ connectionString: databaseUrl });

async function insertStore(suffix: string, name: string) {
  const slug = `${fixturePrefix}${suffix}`;
  const { rows } = await client.query<{ id: number }>("insert into public.stores (slug, name) values ($1, $2) returning id", [slug, name]);
  const store = rows[0];
  if (!store) throw new Error("Fixture store was not inserted");
  return { id: store.id, slug };
}

async function insertOffer(storeId: number, platformId: string, value: number, valuePartial: number | null = null) {
  await client.query(
    `insert into public.offers (store_id, platform_id, reward_type, value, value_partial, raw_text, url, active, last_seen_at)
     values ($1, $2, 'percent', $3, $4, $5, $6, true, now())`,
    [storeId, platformId, value, valuePartial, `${value}%`, `https://example.test/${platformId}`],
  );
}

// `changedAtExpression` é um trecho de SQL estático de teste (ex.: "now() - interval '90 days'"),
// nunca entrada externa — interpolado direto porque `now() - interval` não pode ser bindado
// como parâmetro (viraria um literal de texto inválido para timestamptz).
async function insertHistory(storeId: number, platformId: string, value: number | null, valuePartial: number | null, changedAtExpression: string) {
  await client.query(
    `insert into public.offer_history (store_id, platform_id, reward_type, value, value_partial, changed_at)
     values ($1, $2, 'percent', $3, $4, ${changedAtExpression})`,
    [storeId, platformId, value, valuePartial],
  );
}

async function cleanFixtures() {
  await client.query("delete from public.offer_history where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

beforeAll(async () => {
  await client.connect();
  await cleanFixtures();
});

afterAll(async () => {
  await cleanFixtures();
  await client.end();
});

describe("web_read.store_history", () => {
  it("includes the last event before the 60-day window as an anchor, plus every event inside the window", async () => {
    const store = await insertStore("anchor", "Issue54 Anchor");
    await insertOffer(store.id, "meliuz", 8);
    // Older than the anchor — must never appear, the anchor already covers this period.
    await insertHistory(store.id, "meliuz", 3, null, "now() - interval '120 days'");
    // The anchor: the last event strictly before the 60-day window start.
    await insertHistory(store.id, "meliuz", 5, null, "now() - interval '90 days'");
    // Inside the window.
    await insertHistory(store.id, "meliuz", 8, null, "now() - interval '10 days'");

    const result = await client.query<{ value: number; changed_at: Date }>(
      "select value, changed_at from web_read.store_history($1) where platform_id = 'meliuz' order by changed_at asc",
      [store.slug],
    );

    expect(result.rows.map((row) => row.value)).toEqual([5, 8]);
  });

  it("returns real deactivation as a null-value row rather than omitting or zeroing it", async () => {
    const store = await insertStore("inactive", "Issue54 Inactive");
    await insertOffer(store.id, "zoom", 6);
    await insertHistory(store.id, "zoom", 6, null, "now() - interval '20 days'");
    await insertHistory(store.id, "zoom", null, null, "now() - interval '5 days'");

    const result = await client.query<{ value: number | null }>(
      "select value from web_read.store_history($1) where platform_id = 'zoom' order by changed_at asc",
      [store.slug],
    );

    expect(result.rows.map((row) => row.value)).toEqual([6, null]);
  });

  it("carries value_partial through unchanged for the caller to interpret", async () => {
    const store = await insertStore("inter", "Issue54 Inter");
    await insertOffer(store.id, "inter", 10, 2);
    await insertHistory(store.id, "inter", 10, 2, "now() - interval '15 days'");

    const result = await client.query<{ value: number; value_partial: number | null }>(
      "select value, value_partial from web_read.store_history($1) where platform_id = 'inter'",
      [store.slug],
    );

    expect(result.rows).toEqual([{ value: 10, value_partial: 2 }]);
  });

  it("returns nothing for a store with no offer_history rows, without erroring", async () => {
    const store = await insertStore("empty", "Issue54 Empty");
    await insertOffer(store.id, "cuponomia", 4);

    const result = await client.query("select * from web_read.store_history($1)", [store.slug]);
    expect(result.rows).toEqual([]);
  });

  it("lets farejo_web execute the function but never read offer_history directly", async () => {
    const store = await insertStore("permission", "Issue54 Permission");
    await insertOffer(store.id, "meliuz", 8);
    await insertHistory(store.id, "meliuz", 8, null, "now() - interval '5 days'");

    await client.query("set role farejo_web");
    try {
      await expect(client.query("select * from web_read.store_history($1)", [store.slug])).resolves.toHaveProperty("rows");
      await expect(client.query("select * from public.offer_history")).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("reset role");
    }
  });
});
