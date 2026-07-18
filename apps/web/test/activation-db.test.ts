import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const fixturePrefix = "issue52-activation-";
const client = new Client({ connectionString: databaseUrl });
let storeId: number;

async function cleanFixtures() {
  await client.query("delete from public.activation_metrics where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

beforeAll(async () => {
  await client.connect();
  await cleanFixtures();
  const inserted = await client.query<{ id: number }>("insert into public.stores (slug, name) values ($1, $2) returning id", [`${fixturePrefix}eligible`, "Issue 52 elegível"]);
  const store = inserted.rows[0];
  if (!store) throw new Error("Fixture store was not inserted");
  storeId = store.id;
  await client.query(
    "insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at) values ($1, 'inter', 'percent', 5, '5%', 'https://shopping.inter.co/site-parceiro/lojas/issue52', true, now())",
    [storeId],
  );
});

afterAll(async () => {
  await cleanFixtures();
  await client.end();
});

describe("activation database boundary", () => {
  it("resolves only the current eligible destination through the dedicated operation", async () => {
    await client.query("set role farejo_activation");
    try {
      await expect(client.query("select * from activation.resolve_destination($1, $2)", [`${fixturePrefix}eligible`, "inter"])).resolves.toMatchObject({ rows: [{ store_id: storeId, destination: "https://shopping.inter.co/site-parceiro/lojas/issue52" }] });
      await expect(client.query("select * from public.offers")).rejects.toThrow(/permission denied/i);
      await expect(client.query("select * from web_read.catalog_offers")).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("reset role");
    }
  });

  it("keeps inactive, stale and forged combinations indistinguishable", async () => {
    await client.query("set role farejo_activation");
    try {
      await expect(client.query("select * from activation.resolve_destination($1, $2)", [`${fixturePrefix}eligible`, "zoom"])).resolves.toMatchObject({ rows: [] });
    } finally {
      await client.query("reset role");
    }
    await client.query("update public.offers set last_seen_at = now() - interval '49 hours' where store_id = $1 and platform_id = 'inter'", [storeId]);
    await client.query("set role farejo_activation");
    try {
      await expect(client.query("select * from activation.resolve_destination($1, $2)", [`${fixturePrefix}eligible`, "inter"])).resolves.toMatchObject({ rows: [] });
    } finally {
      await client.query("reset role");
    }
    await client.query("update public.offers set last_seen_at = now(), url = 'https://evil.example.test/issue52' where store_id = $1 and platform_id = 'inter'", [storeId]);
    await client.query("set role farejo_activation");
    try {
      await expect(client.query("select * from activation.resolve_destination($1, $2)", [`${fixturePrefix}eligible`, "inter"])).resolves.toMatchObject({ rows: [] });
    } finally {
      await client.query("reset role");
    }
    await client.query("update public.offers set active = false where store_id = $1 and platform_id = 'inter'", [storeId]);
    await client.query("set role farejo_activation");
    try {
      await expect(client.query("select * from activation.resolve_destination($1, $2)", [`${fixturePrefix}eligible`, "inter"])).resolves.toMatchObject({ rows: [] });
    } finally {
      await client.query("reset role");
    }
  });

  it("lets the metrics role increment only the aggregate without reading operational data", async () => {
    await client.query("set role farejo_metrics");
    try {
      await expect(client.query("select activation.record_activation($1, $2)", [storeId, "inter"])).resolves.toHaveProperty("rows");
      await expect(client.query("select activations from public.activation_metrics where store_id = $1", [storeId])).resolves.toHaveProperty("rows");
      await expect(client.query("select * from public.stores")).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("reset role");
    }
    await expect(client.query("select activations from public.activation_metrics where store_id = $1 and platform_id = 'inter'", [storeId])).resolves.toMatchObject({ rows: [{ activations: 1 }] });
  });

  it("keeps the indexed validation lookup as one dedicated function", async () => {
    await expect(client.query("select to_regclass('public.idx_offers_activation_eligible') as index_name")).resolves.toMatchObject({ rows: [{ index_name: "idx_offers_activation_eligible" }] });
    await expect(client.query("select has_function_privilege('farejo_activation', 'activation.resolve_destination(text, text)', 'execute') as can_resolve, has_function_privilege('farejo_activation', 'activation.record_activation(bigint, text)', 'execute') as can_record, has_function_privilege('farejo_metrics', 'activation.record_activation(bigint, text)', 'execute') as can_record_metric")).resolves.toMatchObject({ rows: [{ can_resolve: true, can_record: false, can_record_metric: true }] });
  });
});
