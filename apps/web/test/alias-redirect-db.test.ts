import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const fixturePrefix = "issue58-web-";
const client = new Client({ connectionString: databaseUrl });

let canonicalId: number;
let canonicalSlug: string;
let absorbedSlug: string;

/**
 * Simula o estado JÁ MATERIALIZADO por um merge (curation.apply_alias_merge, coberto em
 * apps/scraper/src/curation/aliasMerge-db.test.ts) via fixture SQL direta: alias movido
 * pra canônica, oferta movida, redirect registrado. O objetivo aqui é provar que as
 * superfícies de leitura pública (busca, detalhe, ativação, redirect) já refletem esse
 * estado corretamente, sem precisar rodar o merge de verdade.
 */
async function cleanFixtures() {
  await client.query("delete from public.store_aliases where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.store_slug_redirects where from_slug like $1", [`${fixturePrefix}%`]);
  await client.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

beforeAll(async () => {
  await client.connect();
  await cleanFixtures();

  canonicalSlug = `${fixturePrefix}canonical`;
  absorbedSlug = `${fixturePrefix}absorbed`;

  const canonical = await client.query<{ id: number }>("insert into public.stores (slug, name) values ($1, $2) returning id", [canonicalSlug, "Issue58 Canonical"]);
  const canonicalRow = canonical.rows[0];
  if (!canonicalRow) throw new Error("Fixture canonical store was not inserted");
  canonicalId = canonicalRow.id;

  await client.query("insert into public.store_aliases (platform_id, raw_name, store_id, confidence) values ('meliuz', 'Issue58 Canonical Raw', $1, 'confirmed')", [canonicalId]);
  await client.query("insert into public.store_aliases (platform_id, raw_name, store_id, confidence) values ('cuponomia', 'Issue58 Absorbed Raw', $1, 'confirmed')", [canonicalId]);
  await client.query(
    "insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at) values ($1, 'meliuz', 'percent', 5, '5%', 'https://www.meliuz.com.br/issue58', true, now())",
    [canonicalId],
  );
  await client.query(
    "insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at) values ($1, 'cuponomia', 'percent', 7, '7%', 'https://www.cuponomia.com.br/issue58', true, now())",
    [canonicalId],
  );
  await client.query("insert into public.store_slug_redirects (from_slug, to_store_id) values ($1, $2)", [absorbedSlug, canonicalId]);
});

afterAll(async () => {
  await cleanFixtures();
  await client.end();
});

describe("post-merge public read surfaces (F3/T12, #58)", () => {
  it("resolves an absorbed slug to the canonical slug via web_read.store_redirects", async () => {
    await expect(client.query("select to_slug from web_read.store_redirects where from_slug = $1", [absorbedSlug])).resolves.toMatchObject({ rows: [{ to_slug: canonicalSlug }] });
  });

  it("keeps a slug that was never absorbed and never scraped unresolved (still a real 404)", async () => {
    await expect(client.query("select to_slug from web_read.store_redirects where from_slug = $1", [`${fixturePrefix}never-existed`])).resolves.toMatchObject({ rows: [] });
  });

  it("lets farejo_web read the redirect view but never the private redirect table directly", async () => {
    await client.query("set role farejo_web");
    try {
      await expect(client.query("select to_slug from web_read.store_redirects where from_slug = $1", [absorbedSlug])).resolves.toMatchObject({ rows: [{ to_slug: canonicalSlug }] });
      await expect(client.query("select * from public.store_slug_redirects")).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("reset role");
    }
  });

  it("finds the canonical store by the raw name that used to belong to the absorbed store", async () => {
    const result = await client.query<{ slug: string; relevance: number }>(
      "select slug, relevance from web_read.catalog_search($1, 'platforms', 1)",
      ["issue58 absorbed raw"],
    );
    expect(result.rows).toMatchObject([{ slug: canonicalSlug, relevance: 1 }]);
  });

  it("shows the moved offer under the canonical detail", async () => {
    const detail = await client.query<{ slug: string; platform_count: number }>("select slug, platform_count from web_read.store_details where slug = $1", [canonicalSlug]);
    expect(detail.rows).toMatchObject([{ slug: canonicalSlug, platform_count: 2 }]);

    const offers = await client.query<{ platform_id: string }>("select platform_id from web_read.catalog_offers where store_slug = $1 order by platform_id", [canonicalSlug]);
    expect(offers.rows.map((row) => row.platform_id)).toEqual(["cuponomia", "meliuz"]);
  });

  it("resolves activation to only the canonical store's current offer for the moved platform", async () => {
    await client.query("set role farejo_activation");
    try {
      await expect(client.query("select store_id, destination from activation.resolve_destination($1, $2)", [canonicalSlug, "cuponomia"])).resolves.toMatchObject({
        rows: [{ store_id: canonicalId, destination: "https://www.cuponomia.com.br/issue58" }],
      });
      await expect(client.query("select * from activation.resolve_destination($1, $2)", [absorbedSlug, "cuponomia"])).resolves.toMatchObject({ rows: [] });
    } finally {
      await client.query("reset role");
    }
  });
});
