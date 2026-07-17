import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const fixturePrefix = "issue50-search-";
const client = new Client({ connectionString: databaseUrl });

type SearchRow = {
  name: string;
  slug: string;
  platform_count: number;
  relevance: number;
  total_count: number;
};

async function insertStore(name: string, suffix: string, offers: Array<{ platformId: string; rewardType: "percent" | "fixed"; value: number }>) {
  const slug = `${fixturePrefix}${suffix}`;
  const { rows } = await client.query<{ id: number }>(
    "insert into public.stores (slug, name) values ($1, $2) returning id",
    [slug, name],
  );
  const store = rows[0];
  if (!store) throw new Error("Fixture store was not inserted");

  for (const offer of offers) {
    await client.query(
      "insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at) values ($1, $2, $3, $4, $5, $6, true, now())",
      [store.id, offer.platformId, offer.rewardType, offer.value, `${offer.value}`, `https://example.test/${suffix}/${offer.platformId}`],
    );
  }

  return { id: store.id, slug };
}

async function cleanFixtures() {
  await client.query("delete from public.store_aliases where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

async function search(query: string, sort: string, page = 1) {
  const result = await client.query<SearchRow>(
    "select name, slug, platform_count, relevance, total_count from web_read.catalog_search($1, $2, $3)",
    [query, sort, page],
  );
  return result.rows;
}

beforeAll(async () => {
  await client.connect();
  await cleanFixtures();

  const cafe = await insertStore("Café do João", "cafe", [{ platformId: "inter", rewardType: "percent", value: 4 }]);
  await client.query(
    "insert into public.store_aliases (platform_id, raw_name, store_id) values ('meliuz', 'Cafeteria João Oficial', $1)",
    [cafe.id],
  );
  await insertStore("Café Clube", "cafe-clube", [{ platformId: "zoom", rewardType: "percent", value: 3 }]);
  await insertStore("Casas Bahia", "casas-bahia", [{ platformId: "zoom", rewardType: "percent", value: 3 }]);
  await insertStore("Amazom", "amzom", [{ platformId: "inter", rewardType: "percent", value: 2 }]);

  await insertStore("Issue50 Ordenação Percentual alto", "percent-high", [{ platformId: "inter", rewardType: "percent", value: 9 }]);
  await insertStore("Issue50 Ordenação Percentual coberto", "percent-covered", [
    { platformId: "inter", rewardType: "percent", value: 7 },
    { platformId: "meliuz", rewardType: "percent", value: 2 },
  ]);
  await insertStore("Issue50 Ordenação Fixo alto", "fixed-high", [{ platformId: "inter", rewardType: "fixed", value: 100 }]);
  await insertStore("Issue50 Ordenação Zeta empate duas plataformas", "tie-covered", [
    { platformId: "inter", rewardType: "percent", value: 5 },
    { platformId: "meliuz", rewardType: "percent", value: 1 },
  ]);
  await insertStore("Issue50 Ordenação Zulu percentual com fixo", "percent-fixed", [
    { platformId: "inter", rewardType: "percent", value: 5 },
    { platformId: "meliuz", rewardType: "fixed", value: 100 },
  ]);
  await insertStore("Issue50 Ordenação Alfa empate uma plataforma", "tie-single", [{ platformId: "inter", rewardType: "percent", value: 5 }]);

  for (let index = 0; index < 26; index += 1) {
    await insertStore(`Issue50 Página ${String(index).padStart(2, "0")}`, `page-${String(index).padStart(2, "0")}`, [{ platformId: "inter", rewardType: "percent", value: 1 }]);
  }
});

afterAll(async () => {
  await cleanFixtures();
  await client.end();
});

describe("web_read.catalog_search", () => {
  it("normalizes canonical names, slugs and confirmed aliases with ordered relevance classes", async () => {
    expect((await search("  CAFE-do JOÃO! ", "platforms"))[0]).toMatchObject({ name: "Café do João", relevance: 0 });
    expect((await search("cafeteria joão oficial", "platforms"))[0]).toMatchObject({ name: "Café do João", relevance: 1 });
    expect((await search("casasbahia", "platforms"))[0]).toMatchObject({ name: "Casas Bahia", relevance: 0 });
    await expect(search("cafe", "platforms")).resolves.toMatchObject([
      { name: "Café Clube", relevance: 2 },
      { name: "Café do João", relevance: 2 },
    ]);
    await expect(search("do jo", "platforms")).resolves.toMatchObject([{ name: "Café do João", relevance: 3 }]);
    expect((await search("amazm", "platforms"))[0]).toMatchObject({ name: "Amazom", relevance: 4 });
    await expect(search("qz", "platforms")).resolves.toEqual([]);
  });

  it("keeps relevance first and sorts coverage, cashback units and ties deterministically within a class", async () => {
    const cashback = await search("issue50 ordenação", "cashback");
    expect(cashback.slice(0, 6).map((row) => row.name)).toEqual([
      "Issue50 Ordenação Percentual alto",
      "Issue50 Ordenação Percentual coberto",
      "Issue50 Ordenação Zeta empate duas plataformas",
      "Issue50 Ordenação Zulu percentual com fixo",
      "Issue50 Ordenação Alfa empate uma plataforma",
      "Issue50 Ordenação Fixo alto",
    ]);

    const platforms = await search("issue50 ordenação empate", "platforms");
    expect(platforms.findIndex((row) => row.name === "Issue50 Ordenação Zeta empate duas plataformas")).toBeLessThan(
      platforms.findIndex((row) => row.name === "Issue50 Ordenação Alfa empate uma plataforma"),
    );

    const alphabetical = await search("issue50 ordenação empate", "az");
    expect(alphabetical.findIndex((row) => row.name === "Issue50 Ordenação Alfa empate uma plataforma")).toBeLessThan(
      alphabetical.findIndex((row) => row.name === "Issue50 Ordenação Zeta empate duas plataformas"),
    );
  });

  it("paginates the full matching set in stable pages of 24 and normalizes invalid sorts", async () => {
    const firstPage = await search("issue50 página", "platforms");
    const secondPage = await search("issue50 página", "platforms", 2);
    const invalidSort = await search("issue50 ordenação percentual", "not-a-sort");

    expect(firstPage).toHaveLength(24);
    expect(firstPage[0]?.total_count).toBe(26);
    expect(secondPage.map((row) => row.name)).toEqual(["Issue50 Página 24", "Issue50 Página 25"]);
    expect(invalidSort.slice(0, 2).map((row) => row.name)).toEqual(["Issue50 Ordenação Percentual coberto", "Issue50 Ordenação Percentual alto"]);
  });

  it("lets farejo_web execute the search without granting direct access to aliases", async () => {
    await client.query("set role farejo_web");
    try {
      await expect(client.query("select * from web_read.catalog_search($1, $2, $3)", ["cafeteria joão oficial", "platforms", 1])).resolves.toHaveProperty("rows");
      await expect(client.query("select * from public.store_aliases")).rejects.toThrow(/permission denied/i);
      await expect(client.query("select * from web_read.catalog_search_terms")).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("reset role");
    }
  });
});
