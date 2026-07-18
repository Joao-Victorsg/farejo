import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// F3/T9 (#55): versão em lote de `web_read.store_history` — o catálogo pagina até 24 lojas
// por vez e o boost/valor típico de cards precisa do histórico de todas elas numa consulta só.
const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const fixturePrefix = "issue55-catalog-history-";
const client = new Client({ connectionString: databaseUrl });

async function insertStore(suffix: string, name: string) {
  const slug = `${fixturePrefix}${suffix}`;
  const { rows } = await client.query<{ id: number }>("insert into public.stores (slug, name) values ($1, $2) returning id", [slug, name]);
  const store = rows[0];
  if (!store) throw new Error("Fixture store was not inserted");
  return { id: store.id, slug };
}

async function insertOffer(storeId: number, platformId: string, value: number) {
  await client.query(
    `insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at)
     values ($1, $2, 'percent', $3, $4, $5, true, now())`,
    [storeId, platformId, value, `${value}%`, `https://example.test/${platformId}`],
  );
}

// Interpolação direta de `changedAtExpression` é segura aqui: é sempre um trecho estático de
// teste (ex.: "now() - interval '90 days'"), nunca entrada externa.
async function insertHistory(storeId: number, platformId: string, value: number | null, changedAtExpression: string) {
  await client.query(
    `insert into public.offer_history (store_id, platform_id, reward_type, value, changed_at)
     values ($1, $2, 'percent', $3, ${changedAtExpression})`,
    [storeId, platformId, value],
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

describe("web_read.catalog_history", () => {
  it("keeps each store's anchor and window independent inside a single batched call", async () => {
    const storeA = await insertStore("a", "Issue55 Lote A");
    const storeB = await insertStore("b", "Issue55 Lote B");
    await insertOffer(storeA.id, "meliuz", 8);
    await insertOffer(storeB.id, "zoom", 6);

    // Loja A: âncora antes da janela + uma mudança dentro dela.
    await insertHistory(storeA.id, "meliuz", 5, "now() - interval '90 days'");
    await insertHistory(storeA.id, "meliuz", 8, "now() - interval '10 days'");
    // Loja B: só uma leitura recente, sem âncora.
    await insertHistory(storeB.id, "zoom", 6, "now() - interval '5 days'");

    const result = await client.query<{ store_slug: string; platform_id: string; value: number }>(
      "select store_slug, platform_id, value from web_read.catalog_history($1) order by store_slug, changed_at",
      [[storeA.slug, storeB.slug]],
    );

    expect(result.rows.filter((row) => row.store_slug === storeA.slug).map((row) => row.value)).toEqual([5, 8]);
    expect(result.rows.filter((row) => row.store_slug === storeB.slug).map((row) => row.value)).toEqual([6]);
  });

  it("returns nothing for slugs with no offer_history rows, without erroring", async () => {
    const store = await insertStore("empty", "Issue55 Lote Vazio");
    await insertOffer(store.id, "cuponomia", 4);

    const result = await client.query("select * from web_read.catalog_history($1)", [[store.slug]]);
    expect(result.rows).toEqual([]);
  });

  it("returns nothing for an empty slug array", async () => {
    const result = await client.query("select * from web_read.catalog_history($1)", [[]]);
    expect(result.rows).toEqual([]);
  });

  it("lets farejo_web execute the function but never read offer_history directly", async () => {
    const store = await insertStore("permission", "Issue55 Lote Permissão");
    await insertOffer(store.id, "meliuz", 8);
    await insertHistory(store.id, "meliuz", 8, "now() - interval '5 days'");

    await client.query("set role farejo_web");
    try {
      await expect(client.query("select * from web_read.catalog_history($1)", [[store.slug]])).resolves.toHaveProperty("rows");
      await expect(client.query("select * from public.offer_history")).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("reset role");
    }
  });
});
