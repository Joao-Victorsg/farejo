import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const client = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });
const slug = "offer-discrepancy-fixture";

async function clean() {
  await client.query("delete from feedback.offer_discrepancies where store_slug = $1", [slug]);
  await client.query("delete from public.offer_history where store_id in (select id from public.stores where slug = $1)", [slug]);
  await client.query("delete from public.offers where store_id in (select id from public.stores where slug = $1)", [slug]);
  await client.query("delete from public.stores where slug = $1", [slug]);
}

beforeAll(async () => {
  await client.connect();
  await clean();
  const store = await client.query<{ id: number }>("insert into public.stores (slug, name) values ($1, 'Discrepancy Fixture') returning id", [slug]);
  const id = store.rows[0]?.id;
  if (!id) throw new Error("Fixture store missing");
  await client.query("insert into public.offers (store_id, platform_id, reward_type, value, is_upto, raw_text, url, active, last_seen_at) values ($1, 'zoom', 'percent', 5, false, '5%', 'https://www.zoom.com.br/', true, now())", [id]);
  await client.query("insert into public.offer_history (store_id, platform_id, reward_type, value, is_upto) values ($1, 'zoom', 'percent', 5, false)", [id]);
});

afterAll(async () => {
  await clean();
  await client.end();
});

describe("feedback.report_offer_discrepancy", () => {
  it("creates one private report per semantic offer version, then accepts a changed version", async () => {
    await client.query("set role farejo_feedback");
    try {
      const first = await client.query<{ accepted: boolean }>("select feedback.report_offer_discrepancy($1, 'zoom') as accepted", [slug]);
      const duplicate = await client.query<{ accepted: boolean }>("select feedback.report_offer_discrepancy($1, 'zoom') as accepted", [slug]);
      expect(first.rows[0]?.accepted).toBe(true);
      expect(duplicate.rows[0]?.accepted).toBe(true);
    } finally {
      await client.query("reset role");
    }
    const initial = await client.query<{ store_id: number; count: string }>("select store_id, count(*)::text as count from feedback.offer_discrepancies where store_slug = $1 group by store_id", [slug]);
    expect(initial.rows[0]?.count).toBe("1");
    const storeId = initial.rows[0]?.store_id;
    if (!storeId) throw new Error("Fixture report missing");
    await client.query("update public.offers set value = 6, updated_at = now() where store_id = $1 and platform_id = 'zoom'", [storeId]);
    await client.query("insert into public.offer_history (store_id, platform_id, reward_type, value, is_upto) values ($1, 'zoom', 'percent', 6, false)", [storeId]);
    await client.query("set role farejo_feedback");
    try {
      await client.query("select feedback.report_offer_discrepancy($1, 'zoom')", [slug]);
    } finally {
      await client.query("reset role");
    }
    const updated = await client.query<{ count: string }>("select count(*)::text as count from feedback.offer_discrepancies where store_slug = $1", [slug]);
    expect(updated.rows[0]?.count).toBe("2");
  });

  it("allows only the dedicated role to execute; no public role reads the queue", async () => {
    for (const role of ["anon", "authenticated", "farejo_web"]) {
      await client.query(`set role ${role}`);
      try {
        await expect(client.query("select feedback.report_offer_discrepancy($1, 'zoom')", [slug])).rejects.toThrow(/permission denied/i);
        await expect(client.query("select * from feedback.offer_discrepancies")).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query("reset role");
      }
    }
  });
});
