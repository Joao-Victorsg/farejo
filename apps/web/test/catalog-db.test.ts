import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const fixturePrefix = "issue48-catalog-";
const freshAt = new Date();
const delayedAt = new Date(Date.now() - 30 * 60 * 60 * 1_000);
const expiredAt = new Date(Date.now() - 49 * 60 * 60 * 1_000);
const client = new Client({ connectionString: databaseUrl });

async function cleanFixtures() {
  await client.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

beforeAll(async () => {
  await client.connect();
  await cleanFixtures();

  for (let index = 0; index < 26; index += 1) {
    const slug = `${fixturePrefix}${String(index).padStart(2, "0")}`;
    const name = `Issue 48 catálogo ${String(index).padStart(2, "0")}`;
    const { rows } = await client.query<{ id: number }>(
      "insert into public.stores (slug, name) values ($1, $2) returning id",
      [slug, name],
    );
    const store = rows[0];
    if (!store) throw new Error("Fixture store was not inserted");

    await client.query(
      "insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at) values ($1, 'inter', 'percent', 5, '5%', 'https://example.test/inter', true, $2)",
      [store.id, index === 1 ? delayedAt : freshAt],
    );
    if (index === 0) {
      await client.query(
        "insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at) values ($1, 'meliuz', 'percent', 6, '6%', 'https://example.test/meliuz', true, $2)",
        [store.id, delayedAt],
      );
    }
  }

  const { rows } = await client.query<{ id: number }>(
    "insert into public.stores (slug, name) values ($1, $2) returning id",
    [`${fixturePrefix}expired`, "Issue 48 expirado"],
  );
  const expiredStore = rows[0];
  if (!expiredStore) throw new Error("Expired fixture store was not inserted");
  await client.query(
    "insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at) values ($1, 'zoom', 'percent', 7, '7%', 'https://example.test/zoom', true, $2)",
    [expiredStore.id, expiredAt],
  );
});

afterAll(async () => {
  await cleanFixtures();
  await client.end();
});

describe("web_read catalog", () => {
  it("exposes only the catalog allowlist", async () => {
    const columns = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'web_read'
         and table_name in ('catalog_offers', 'catalog_stores')
       order by table_name, ordinal_position`,
    );

    expect(columns.rows).toEqual([
      { table_name: "catalog_offers", column_name: "store_slug" },
      { table_name: "catalog_offers", column_name: "platform_id" },
      { table_name: "catalog_offers", column_name: "platform_name" },
      { table_name: "catalog_offers", column_name: "reward_type" },
      { table_name: "catalog_offers", column_name: "value" },
      { table_name: "catalog_offers", column_name: "value_partial" },
      { table_name: "catalog_offers", column_name: "is_upto" },
      { table_name: "catalog_offers", column_name: "freshness" },
      { table_name: "catalog_stores", column_name: "slug" },
      { table_name: "catalog_stores", column_name: "name" },
      { table_name: "catalog_stores", column_name: "logo_url" },
      { table_name: "catalog_stores", column_name: "platform_count" },
    ]);
  });

  it("keeps fresh and delayed offers eligible in deterministic 24-store pages", async () => {
    const firstPage = await client.query<{ slug: string; platform_count: number }>(
      "select slug, platform_count from web_read.catalog_stores where slug like $1 order by platform_count desc, name asc, slug asc limit 24",
      [`${fixturePrefix}%`],
    );
    const secondPage = await client.query<{ slug: string }>(
      "select slug from web_read.catalog_stores where slug like $1 order by platform_count desc, name asc, slug asc limit 24 offset 24",
      [`${fixturePrefix}%`],
    );
    const delayedOffer = await client.query<{ freshness: string }>(
      "select freshness from web_read.catalog_offers where store_slug = $1 and platform_id = 'meliuz'",
      [`${fixturePrefix}00`],
    );

    expect(firstPage.rows).toHaveLength(24);
    expect(firstPage.rows[0]).toEqual({ slug: `${fixturePrefix}00`, platform_count: 2 });
    expect(secondPage.rows.map((row) => row.slug)).toEqual([`${fixturePrefix}24`, `${fixturePrefix}25`]);
    expect(delayedOffer.rows).toEqual([{ freshness: "delayed" }]);
    expect([...firstPage.rows, ...secondPage.rows].map((row) => row.slug)).not.toContain(`${fixturePrefix}expired`);
  });

  it("limits farejo_web to the explicit catalog views", async () => {
    const role = await client.query<{ rolcanlogin: boolean; has_timeout: boolean }>(
      "select rolcanlogin, coalesce(rolconfig, array[]::text[]) @> array['statement_timeout=3s'] as has_timeout from pg_roles where rolname = 'farejo_web'",
    );
    expect(role.rows).toEqual([{ rolcanlogin: true, has_timeout: true }]);

    const privileges = await client.query<{
      offers: boolean;
      scrape_runs: boolean;
      crawl_state: boolean;
      pipeline_write_offers: boolean;
    }>(
      `select
        has_table_privilege('farejo_web', 'public.offers', 'select') as offers,
        has_table_privilege('farejo_web', 'public.scrape_runs', 'select') as scrape_runs,
        has_table_privilege('farejo_web', 'public.crawl_state', 'select') as crawl_state,
        has_function_privilege('farejo_web', procedures.oid, 'execute') as pipeline_write_offers
       from pg_proc as procedures
       join pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
       where namespaces.nspname = 'public'
         and procedures.proname = 'pipeline_write_offers'`,
    );
    expect(privileges.rows).toEqual([{ offers: false, scrape_runs: false, crawl_state: false, pipeline_write_offers: false }]);

    await client.query("set role farejo_web");
    try {
      const catalog = await client.query("select slug, platform_count from web_read.catalog_stores where slug = $1", [`${fixturePrefix}00`]);
      expect(catalog.rows).toHaveLength(1);
      await expect(client.query("select * from public.offers")).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("reset role");
    }

    for (const roleName of ["anon", "authenticated"]) {
      await client.query(`set role ${roleName}`);
      try {
        await expect(client.query("select * from web_read.catalog_stores")).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query("reset role");
      }
    }
  });
});
