import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const fixturePrefix = "issue51-detail-";
const client = new Client({ connectionString: databaseUrl });

async function insertStore(name: string, suffix: string) {
  const slug = `${fixturePrefix}${suffix}`;
  const { rows } = await client.query<{ id: number }>(
    "insert into public.stores (slug, name) values ($1, $2) returning id",
    [slug, name],
  );
  const store = rows[0];
  if (!store) throw new Error("Fixture store was not inserted");
  return { id: store.id, slug };
}

async function insertOffer(storeId: number, platformId: string, rewardType: "percent" | "fixed", value: number, options: { isUpto?: boolean; active?: boolean; hoursOld?: number } = {}) {
  await client.query(
    `insert into public.offers (store_id, platform_id, reward_type, value, is_upto, raw_text, url, active, last_seen_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now() - ($9::text || ' hours')::interval)`,
    [storeId, platformId, rewardType, value, options.isUpto ?? false, `${value}`, `https://example.test/${platformId}`, options.active ?? true, String(options.hoursOld ?? 0)],
  );
}

async function cleanFixtures() {
  await client.query("delete from public.store_aliases where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

beforeAll(async () => {
  await client.connect();
  await cleanFixtures();

  const mixed = await insertStore("Issue51 Ranking misto", "mixed");
  await insertOffer(mixed.id, "inter", "percent", 3, { isUpto: true });
  await insertOffer(mixed.id, "meliuz", "percent", 5, { hoursOld: 26 });
  await insertOffer(mixed.id, "zoom", "fixed", 30);

  const single = await insertStore("Issue51 Uma plataforma", "single");
  await insertOffer(single.id, "cuponomia", "percent", 2);

  const unavailable = await insertStore("Issue51 Indisponível", "unavailable");
  await insertOffer(unavailable.id, "inter", "percent", 4, { active: false });
});

afterAll(async () => {
  await cleanFixtures();
  await client.end();
});

describe("web_read.store_details", () => {
  it("keeps a canonical store readable when it has no eligible offer", async () => {
    const result = await client.query<{ slug: string; platform_count: number }>(
      "select slug, platform_count from web_read.store_details where slug = $1",
      [`${fixturePrefix}unavailable`],
    );
    expect(result.rows).toEqual([{ slug: `${fixturePrefix}unavailable`, platform_count: 0 }]);
  });

  it("exposes only presentation fields for eligible detail offers", async () => {
    const result = await client.query<{
      platform_id: string;
      reward_type: string;
      value: number;
      is_upto: boolean;
      freshness: string;
      last_seen_at: Date;
    }>(
      "select platform_id, reward_type, value, is_upto, freshness, last_seen_at from web_read.catalog_offers where store_slug = $1 order by platform_id",
      [`${fixturePrefix}mixed`],
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows.find((row) => row.platform_id === "inter")).toMatchObject({ reward_type: "percent", value: 3, is_upto: true, freshness: "fresh" });
    expect(result.rows.find((row) => row.platform_id === "meliuz")).toMatchObject({ reward_type: "percent", value: 5, freshness: "delayed" });
    expect(result.rows.every((row) => row.last_seen_at instanceof Date)).toBe(true);
  });

  it("lets farejo_web read detail views but never operational offers", async () => {
    await client.query("set role farejo_web");
    try {
      await expect(client.query("select * from web_read.store_details where slug = $1", [`${fixturePrefix}mixed`])).resolves.toHaveProperty("rows");
      await expect(client.query("select * from public.offers")).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("reset role");
    }
  });
});
