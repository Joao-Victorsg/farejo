import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const fixturePrefix = "issue58-curation-";
const client = new Client({ connectionString: databaseUrl });

interface StoreFixture {
  id: number;
  slug: string;
}

async function cleanFixtures() {
  await client.query(
    "delete from public.activation_metrics where store_id in (select id from public.stores where slug like $1)",
    [`${fixturePrefix}%`],
  );
  await client.query(
    "delete from public.store_logo_sources where store_id in (select id from public.stores where slug like $1)",
    [`${fixturePrefix}%`],
  );
  await client.query(
    "delete from public.crawl_state where store_id in (select id from public.stores where slug like $1)",
    [`${fixturePrefix}%`],
  );
  await client.query(
    "delete from public.offer_history where store_id in (select id from public.stores where slug like $1)",
    [`${fixturePrefix}%`],
  );
  await client.query(
    "delete from public.offers where store_id in (select id from public.stores where slug like $1)",
    [`${fixturePrefix}%`],
  );
  await client.query(
    "delete from public.store_aliases where store_id in (select id from public.stores where slug like $1)",
    [`${fixturePrefix}%`],
  );
  await client.query("delete from public.store_slug_redirects where from_slug like $1", [`${fixturePrefix}%`]);
  await client.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

async function createStore(slug: string, name: string): Promise<StoreFixture> {
  const result = await client.query<{ id: number }>("insert into public.stores (slug, name) values ($1, $2) returning id", [slug, name]);
  const row = result.rows[0];
  if (!row) throw new Error(`Fixture store "${slug}" was not inserted`);
  return { id: row.id, slug };
}

async function createAlias(platformId: string, rawName: string, storeId: number) {
  await client.query("insert into public.store_aliases (platform_id, raw_name, store_id, confidence) values ($1, $2, $3, 'auto')", [platformId, rawName, storeId]);
}

async function createOffer(storeId: number, platformId: string, value: number) {
  await client.query(
    "insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at) values ($1, $2, 'percent', $3, $4, $5, true, now())",
    [storeId, platformId, value, `${value}%`, `https://example.test/${platformId}`],
  );
}

async function applyMerge(canonicalSlug: string, aliases: { platformId: string; rawName: string }[]) {
  await client.query("set role farejo_curation");
  try {
    return await client.query<{ applied: boolean; reason: string; absorbed_slugs: string[] | null }>(
      "select * from curation.apply_alias_merge($1, $2)",
      [canonicalSlug, JSON.stringify(aliases)],
    );
  } finally {
    await client.query("reset role");
  }
}

beforeAll(async () => {
  await client.connect();
});

beforeEach(async () => {
  await cleanFixtures();
});

afterAll(async () => {
  await cleanFixtures();
  await client.end();
});

describe("curation.apply_alias_merge", () => {
  it("moves aliases, offers, history, crawl_state, logo sources and activation metrics into the canonical store", async () => {
    const canonical = await createStore(`${fixturePrefix}canonical`, "Canonical");
    const absorbed = await createStore(`${fixturePrefix}absorbed`, "Absorbed");
    await createAlias("meliuz", "Canonical Raw", canonical.id);
    await createAlias("cuponomia", "Absorbed Raw", absorbed.id);
    await createOffer(canonical.id, "meliuz", 5);
    await createOffer(absorbed.id, "cuponomia", 7);
    await client.query("insert into public.offer_history (store_id, platform_id, reward_type, value, is_upto, changed_at) values ($1, 'cuponomia', 'percent', 7, false, now())", [absorbed.id]);
    await client.query("insert into public.crawl_state (platform_id, slug, store_id, tier, last_checked_at, last_outcome) values ('cuponomia', $1, $2, 'active', now(), 'offer')", [`${fixturePrefix}absorbed-crawl`, absorbed.id]);
    await client.query("insert into public.store_logo_sources (store_id, platform_id, url, last_seen_at) values ($1, 'cuponomia', 'https://logo.test/absorbed.png', now())", [absorbed.id]);
    await client.query("insert into public.activation_metrics (day, store_id, platform_id, activations) values (current_date, $1, 'cuponomia', 3)", [absorbed.id]);

    const result = await applyMerge(canonical.slug, [
      { platformId: "meliuz", rawName: "Canonical Raw" },
      { platformId: "cuponomia", rawName: "Absorbed Raw" },
    ]);

    expect(result.rows).toMatchObject([{ applied: true, reason: "merged", absorbed_slugs: [absorbed.slug] }]);

    await expect(client.query("select store_id from public.store_aliases where platform_id = 'cuponomia' and raw_name = 'Absorbed Raw'")).resolves.toMatchObject({ rows: [{ store_id: canonical.id }] });
    await expect(client.query("select store_id from public.offers where platform_id = 'cuponomia' and store_id = $1", [canonical.id])).resolves.toMatchObject({ rows: [{ store_id: canonical.id }] });
    await expect(client.query("select store_id from public.offer_history where platform_id = 'cuponomia' and store_id = $1", [canonical.id])).resolves.toMatchObject({ rows: [{ store_id: canonical.id }] });
    await expect(client.query("select store_id from public.crawl_state where slug = $1", [`${fixturePrefix}absorbed-crawl`])).resolves.toMatchObject({ rows: [{ store_id: canonical.id }] });
    await expect(client.query("select store_id, url from public.store_logo_sources where store_id = $1 and platform_id = 'cuponomia'", [canonical.id])).resolves.toMatchObject({ rows: [{ store_id: canonical.id, url: "https://logo.test/absorbed.png" }] });
    await expect(client.query("select activations from public.activation_metrics where store_id = $1 and platform_id = 'cuponomia'", [canonical.id])).resolves.toMatchObject({ rows: [{ activations: 3 }] });
    await expect(client.query("select id from public.stores where id = $1", [absorbed.id])).resolves.toMatchObject({ rows: [] });
    await expect(client.query("select to_store_id from public.store_slug_redirects where from_slug = $1", [absorbed.slug])).resolves.toMatchObject({ rows: [{ to_store_id: canonical.id }] });
  });

  it("keeps a more recent canonical logo source and sums activations already present on the canonical store", async () => {
    const canonical = await createStore(`${fixturePrefix}canonical-merge`, "Canonical");
    const absorbed = await createStore(`${fixturePrefix}absorbed-merge`, "Absorbed");
    await createAlias("meliuz", "Canonical Raw 2", canonical.id);
    await createAlias("cuponomia", "Absorbed Raw 2", absorbed.id);
    await createOffer(canonical.id, "meliuz", 5);
    await createOffer(absorbed.id, "cuponomia", 7);
    await client.query("insert into public.store_logo_sources (store_id, platform_id, url, last_seen_at) values ($1, 'zoom', 'https://logo.test/canonical-newer.png', now())", [canonical.id]);
    await client.query("insert into public.store_logo_sources (store_id, platform_id, url, last_seen_at) values ($1, 'zoom', 'https://logo.test/absorbed-older.png', now() - interval '1 day')", [absorbed.id]);
    await client.query("insert into public.activation_metrics (day, store_id, platform_id, activations) values (current_date, $1, 'meliuz', 2)", [canonical.id]);
    await client.query("insert into public.activation_metrics (day, store_id, platform_id, activations) values (current_date, $1, 'meliuz', 5)", [absorbed.id]);

    await applyMerge(canonical.slug, [
      { platformId: "meliuz", rawName: "Canonical Raw 2" },
      { platformId: "cuponomia", rawName: "Absorbed Raw 2" },
    ]);

    await expect(client.query("select url from public.store_logo_sources where store_id = $1 and platform_id = 'zoom'", [canonical.id])).resolves.toMatchObject({ rows: [{ url: "https://logo.test/canonical-newer.png" }] });
    await expect(client.query("select activations from public.activation_metrics where store_id = $1 and platform_id = 'meliuz'", [canonical.id])).resolves.toMatchObject({ rows: [{ activations: 7 }] });
  });

  it("converges to a no-op when the same decision is applied twice", async () => {
    const canonical = await createStore(`${fixturePrefix}idem-canonical`, "Canonical");
    const absorbed = await createStore(`${fixturePrefix}idem-absorbed`, "Absorbed");
    await createAlias("meliuz", "Idem Canonical Raw", canonical.id);
    await createAlias("cuponomia", "Idem Absorbed Raw", absorbed.id);
    await createOffer(canonical.id, "meliuz", 5);
    await createOffer(absorbed.id, "cuponomia", 7);
    const decision = [
      { platformId: "meliuz", rawName: "Idem Canonical Raw" },
      { platformId: "cuponomia", rawName: "Idem Absorbed Raw" },
    ];

    const first = await applyMerge(canonical.slug, decision);
    expect(first.rows).toMatchObject([{ applied: true, reason: "merged" }]);

    const historyCountAfterFirst = await client.query("select count(*)::int as count from public.offer_history where store_id = $1", [canonical.id]);

    const second = await applyMerge(canonical.slug, decision);
    expect(second.rows).toMatchObject([{ applied: true, reason: "noop", absorbed_slugs: [] }]);

    const historyCountAfterSecond = await client.query("select count(*)::int as count from public.offer_history where store_id = $1", [canonical.id]);
    expect(historyCountAfterSecond.rows[0]?.count).toBe(historyCountAfterFirst.rows[0]?.count);
  });

  it("resolves canonical_not_found without touching anything when the canonical slug has not been scraped yet", async () => {
    const result = await applyMerge(`${fixturePrefix}never-scraped`, [{ platformId: "meliuz", rawName: "Whatever" }]);
    expect(result.rows).toMatchObject([{ applied: false, reason: "canonical_not_found", absorbed_slugs: null }]);
  });

  it("converges a transitive chain: a redirect pointing at an absorbed store is repointed to the new canonical", async () => {
    const storeX = await createStore(`${fixturePrefix}chain-x`, "X");
    const storeY = await createStore(`${fixturePrefix}chain-y`, "Y");
    const storeZ = await createStore(`${fixturePrefix}chain-z`, "Z");
    await createAlias("inter", "X Raw", storeX.id);
    await createAlias("zoom", "Y Raw", storeY.id);
    await createAlias("mycashback", "Z Raw", storeZ.id);
    await createOffer(storeX.id, "inter", 3);
    await createOffer(storeY.id, "zoom", 4);
    await createOffer(storeZ.id, "mycashback", 6);

    const firstMerge = await applyMerge(storeY.slug, [{ platformId: "inter", rawName: "X Raw" }]);
    expect(firstMerge.rows).toMatchObject([{ applied: true, reason: "merged", absorbed_slugs: [storeX.slug] }]);
    await expect(client.query("select to_store_id from public.store_slug_redirects where from_slug = $1", [storeX.slug])).resolves.toMatchObject({ rows: [{ to_store_id: storeY.id }] });

    const secondMerge = await applyMerge(storeZ.slug, [{ platformId: "zoom", rawName: "Y Raw" }]);
    expect(secondMerge.rows).toMatchObject([{ applied: true, reason: "merged", absorbed_slugs: [storeY.slug] }]);

    await expect(client.query("select to_store_id from public.store_slug_redirects where from_slug = $1", [storeY.slug])).resolves.toMatchObject({ rows: [{ to_store_id: storeZ.id }] });
    await expect(client.query("select to_store_id from public.store_slug_redirects where from_slug = $1", [storeX.slug])).resolves.toMatchObject({ rows: [{ to_store_id: storeZ.id }] });
    await expect(client.query("select store_id from public.offers where platform_id = 'inter' and store_id = $1", [storeZ.id])).resolves.toMatchObject({ rows: [{ store_id: storeZ.id }] });
  });

  it("aborts the whole decision without any partial write when the cluster has two offers from the same platform", async () => {
    const canonical = await createStore(`${fixturePrefix}conflict-canonical`, "Canonical");
    const absorbed = await createStore(`${fixturePrefix}conflict-absorbed`, "Absorbed");
    await createAlias("meliuz", "Conflict Canonical Raw", canonical.id);
    await createAlias("meliuz", "Conflict Absorbed Raw", absorbed.id);
    await createOffer(canonical.id, "meliuz", 5);
    await createOffer(absorbed.id, "meliuz", 9);

    await client.query("set role farejo_curation");
    try {
      await expect(
        client.query("select * from curation.apply_alias_merge($1, $2)", [
          canonical.slug,
          JSON.stringify([
            { platformId: "meliuz", rawName: "Conflict Canonical Raw" },
            { platformId: "meliuz", rawName: "Conflict Absorbed Raw" },
          ]),
        ]),
      ).rejects.toThrow(/conflitantes/);
    } finally {
      await client.query("reset role");
    }

    await expect(client.query("select id from public.stores where id = $1", [absorbed.id])).resolves.toMatchObject({ rows: [{ id: absorbed.id }] });
    await expect(client.query("select store_id from public.offers where platform_id = 'meliuz' and store_id = $1", [absorbed.id])).resolves.toMatchObject({ rows: [{ store_id: absorbed.id }] });
    await expect(client.query("select * from public.store_slug_redirects where from_slug = $1", [absorbed.slug])).resolves.toMatchObject({ rows: [] });
  });

  it("lets farejo_curation execute the merge but not read operational tables directly", async () => {
    await client.query("set role farejo_curation");
    try {
      await expect(client.query("select * from public.offers")).rejects.toThrow(/permission denied/i);
      await expect(client.query("select * from public.stores")).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("reset role");
    }
    await expect(
      client.query("select has_function_privilege('farejo_curation', 'curation.apply_alias_merge(text, jsonb)', 'execute') as can_apply"),
    ).resolves.toMatchObject({ rows: [{ can_apply: true }] });
  });
});
