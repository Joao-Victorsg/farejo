import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { computeLogoCoverage } from "./coverage.js";

/**
 * F3/T16 (#62, ADR-0054) — prova o agregado real (`web_read.logo_coverage`) sob a role
 * `farejo_logo_coverage`: elegibilidade vem só de `public.offers`, nunca de uma leitura
 * direta que a role em si não teria permissão de fazer.
 */
type SupabaseStatus = { DB_URL: string };

const status: SupabaseStatus = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf-8" }));

const adminClient = new Client({ connectionString: status.DB_URL });
const coverageClient = new Client({ connectionString: status.DB_URL });

const fixturePrefix = "issue62-coverage-";

async function insertStore(suffix: string, logoHash: string | null): Promise<number> {
  const slug = `${fixturePrefix}${suffix}`;
  const { rows } = await adminClient.query<{ id: number }>(
    "insert into public.stores (slug, name, logo_hash) values ($1, $2, $3) returning id",
    [slug, slug, logoHash],
  );
  return rows[0]!.id;
}

async function insertActiveOffer(storeId: number): Promise<void> {
  await adminClient.query(
    `insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at)
     values ($1, 'zoom', 'percent', 5, '5%', 'https://example.test', true, now())`,
    [storeId],
  );
}

async function insertInactiveOffer(storeId: number): Promise<void> {
  await adminClient.query(
    `insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at)
     values ($1, 'zoom', 'percent', 5, '5%', 'https://example.test', false, now())`,
    [storeId],
  );
}

async function cleanFixtures(): Promise<void> {
  await adminClient.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [
    `${fixturePrefix}%`,
  ]);
  await adminClient.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

describe("logo coverage aggregate (Postgres local, F3/T16/#62)", () => {
  beforeAll(async () => {
    await adminClient.connect();
    await coverageClient.connect();
    await coverageClient.query("set role farejo_logo_coverage");
    await cleanFixtures();
  });

  afterEach(async () => {
    await cleanFixtures();
  });

  afterAll(async () => {
    await cleanFixtures();
    await coverageClient.query("reset role");
    await coverageClient.end();
    await adminClient.end();
  });

  it("cannot read a single row from public.offers directly", async () => {
    await expect(coverageClient.query("select 1 from public.offers limit 1")).rejects.toThrow(/permission denied/i);
  });

  it("counts a store with an active offer and a final logo as covered", async () => {
    const store = await insertStore("with-logo", "deadbeef");
    await insertActiveOffer(store);

    const before = await computeLogoCoverage(coverageClient);
    const store2 = await insertStore("without-logo", null);
    await insertActiveOffer(store2);
    const after = await computeLogoCoverage(coverageClient);

    expect(after.eligibleStores).toBe(before.eligibleStores + 1);
    expect(after.storesWithLogo).toBe(before.storesWithLogo);
  });

  it("does not count a store whose only offer is inactive as eligible", async () => {
    const before = await computeLogoCoverage(coverageClient);
    const store = await insertStore("inactive-only", "deadbeef");
    await insertInactiveOffer(store);
    const after = await computeLogoCoverage(coverageClient);

    expect(after.eligibleStores).toBe(before.eligibleStores);
  });
});
