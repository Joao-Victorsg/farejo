import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// F3/T10 (#56, ADR-0019/ADR-0020): `web_read.platform_stats` agrega cobertura, média e pico
// por plataforma sem misturar percentual com valor fixo. `store_slugs` escopa a fixtures
// próprias (mesmo padrão de `web_read.catalog_history`, #55) para não depender do resto do
// banco compartilhado pelos outros arquivos de teste.
const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const fixturePrefix = "issue56-platform-stats-";
const client = new Client({ connectionString: databaseUrl });

async function insertStore(suffix: string, name: string) {
  const slug = `${fixturePrefix}${suffix}`;
  const { rows } = await client.query<{ id: number }>("insert into public.stores (slug, name) values ($1, $2) returning id", [slug, name]);
  const store = rows[0];
  if (!store) throw new Error("Fixture store was not inserted");
  return { id: store.id, slug };
}

async function insertOffer(storeId: number, platformId: string, options: { rewardType: "percent" | "fixed"; value: number; valuePartial?: number; isUpto?: boolean }) {
  await client.query(
    `insert into public.offers (store_id, platform_id, reward_type, value, value_partial, is_upto, raw_text, url, active, last_seen_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, true, now())`,
    [storeId, platformId, options.rewardType, options.value, options.valuePartial ?? null, options.isUpto ?? false, `${options.value}`, `https://example.test/${platformId}`],
  );
}

async function cleanFixtures() {
  await client.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

type PlatformStatsRow = {
  platform_id: string;
  store_count: number;
  percent_avg: number | null;
  percent_max: number | null;
  percent_max_is_upto: boolean | null;
};

function statFor(rows: PlatformStatsRow[], platformId: string) {
  const row = rows.find((candidate) => candidate.platform_id === platformId);
  if (!row) throw new Error(`No platform_stats row for ${platformId}`);
  return row;
}

beforeAll(async () => {
  await client.connect();
  await cleanFixtures();
});

afterAll(async () => {
  await cleanFixtures();
  await client.end();
});

describe("web_read.platform_stats", () => {
  it("counts coverage across percent and fixed offers but averages/peaks only percent, equal weight per store", async () => {
    const storeA = await insertStore("meliuz-a", "Issue56 Méliuz A");
    const storeB = await insertStore("meliuz-b", "Issue56 Méliuz B");
    const storeC = await insertStore("meliuz-c", "Issue56 Méliuz C");
    await insertOffer(storeA.id, "meliuz", { rewardType: "percent", value: 10 });
    await insertOffer(storeB.id, "meliuz", { rewardType: "percent", value: 20 });
    await insertOffer(storeC.id, "meliuz", { rewardType: "fixed", value: 30 });

    const result = await client.query<PlatformStatsRow>(
      "select platform_id, store_count, percent_avg, percent_max, percent_max_is_upto from web_read.platform_stats($1)",
      [[storeA.slug, storeB.slug, storeC.slug]],
    );

    const meliuz = statFor(result.rows, "meliuz");
    expect(meliuz.store_count).toBe(3);
    expect(meliuz.percent_avg).toBe(15);
    expect(meliuz.percent_max).toBe(20);
    expect(meliuz.percent_max_is_upto).toBe(false);
  });

  it("breaks a peak tie in favor of the guaranteed rate over an up-to ceiling", async () => {
    const storeF = await insertStore("cuponomia-f", "Issue56 Cuponomia F");
    const storeG = await insertStore("cuponomia-g", "Issue56 Cuponomia G");
    await insertOffer(storeF.id, "cuponomia", { rewardType: "percent", value: 30, isUpto: true });
    await insertOffer(storeG.id, "cuponomia", { rewardType: "percent", value: 30, isUpto: false });

    const result = await client.query<PlatformStatsRow>(
      "select platform_id, percent_max, percent_max_is_upto from web_read.platform_stats($1)",
      [[storeF.slug, storeG.slug]],
    );

    const cuponomia = statFor(result.rows, "cuponomia");
    expect(cuponomia.percent_max).toBe(30);
    expect(cuponomia.percent_max_is_upto).toBe(false);
  });

  it("preserves is_upto when the up-to offer is the sole/highest percent", async () => {
    const storeD = await insertStore("zoom-d", "Issue56 Zoom D");
    const storeE = await insertStore("zoom-e", "Issue56 Zoom E");
    await insertOffer(storeD.id, "zoom", { rewardType: "percent", value: 15, isUpto: true });
    await insertOffer(storeE.id, "zoom", { rewardType: "percent", value: 8, isUpto: false });

    const result = await client.query<PlatformStatsRow>(
      "select platform_id, percent_max, percent_max_is_upto from web_read.platform_stats($1)",
      [[storeD.slug, storeE.slug]],
    );

    const zoom = statFor(result.rows, "zoom");
    expect(zoom.percent_max).toBe(15);
    expect(zoom.percent_max_is_upto).toBe(true);
  });

  it("aggregates the Inter correntista rate (value), never value_partial", async () => {
    const storeH = await insertStore("inter-h", "Issue56 Inter H");
    await insertOffer(storeH.id, "inter", { rewardType: "percent", value: 12, valuePartial: 3 });

    const result = await client.query<PlatformStatsRow>(
      "select platform_id, percent_avg, percent_max from web_read.platform_stats($1)",
      [[storeH.slug]],
    );

    const inter = statFor(result.rows, "inter");
    expect(inter.percent_avg).toBe(12);
    expect(inter.percent_max).toBe(12);
  });

  it("returns null average/peak (never zero) and always lists all five platforms when a scope has no matching stores", async () => {
    const store = await insertStore("empty-scope", "Issue56 Escopo Vazio");

    const result = await client.query<PlatformStatsRow>("select platform_id, store_count, percent_avg, percent_max from web_read.platform_stats($1)", [[store.slug]]);

    expect(result.rows.map((row) => row.platform_id).sort()).toEqual(["cuponomia", "inter", "meliuz", "mycashback", "zoom"]);
    for (const row of result.rows) {
      expect(row.store_count).toBe(0);
      expect(row.percent_avg).toBeNull();
      expect(row.percent_max).toBeNull();
    }
  });

  it("lets farejo_web execute the function but never read offers directly", async () => {
    const store = await insertStore("permission", "Issue56 Permissão");
    await insertOffer(store.id, "meliuz", { rewardType: "percent", value: 9 });

    await client.query("set role farejo_web");
    try {
      await expect(client.query("select * from web_read.platform_stats($1)", [[store.slug]])).resolves.toHaveProperty("rows");
      await expect(client.query("select * from public.offers")).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("reset role");
    }

    for (const roleName of ["anon", "authenticated"]) {
      await client.query(`set role ${roleName}`);
      try {
        await expect(client.query("select * from web_read.platform_stats($1)", [[store.slug]])).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query("reset role");
      }
    }
  });
});
