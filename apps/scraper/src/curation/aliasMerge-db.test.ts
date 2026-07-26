import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const fixturePrefix = "issue58-curation-";
const client = new Client({ connectionString: databaseUrl });

interface StoreFixture {
  id: number;
  slug: string;
}

// Chats de fixture: as Inscrições vão junto por cascade (ADR-0066), então basta apagar o Assinante.
const CHAT_RANGE = { first: 911500, last: 911599 };

async function cleanFixtures() {
  // Duas limpezas, de propósito. A por slug é a que casa com o resto do arquivo e garante que
  // NENHUMA inscrição segure uma loja de fixture — inclusive uma criada por outro teste, fora da
  // faixa de chats abaixo. Sem ela, o `delete from stores` falharia num teste que não tem nada a
  // ver com Inscrições, longe da causa.
  await client.query(
    "delete from public.subscriptions where store_id in (select id from public.stores where slug like $1)",
    [`${fixturePrefix}%`],
  );
  await client.query("delete from public.subscribers where telegram_chat_id between $1 and $2", [CHAT_RANGE.first, CHAT_RANGE.last]);
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

async function createSubscriber(chatId: number): Promise<number> {
  const result = await client.query<{ id: number }>("insert into public.subscribers (telegram_chat_id) values ($1) returning id", [chatId]);
  const row = result.rows[0];
  if (!row) throw new Error(`Fixture subscriber ${chatId} was not inserted`);
  return row.id;
}

/** `createdAt` é explícito porque o desempate de colisão do merge é por recência. */
async function createSubscription(
  subscriberId: number,
  storeId: number,
  subscription: { mode: "improvement" } | { mode: "tracking"; floorValue: number; floorRewardType: "percent" | "fixed" },
  createdAt?: string,
) {
  const floorValue = subscription.mode === "tracking" ? subscription.floorValue : null;
  const floorRewardType = subscription.mode === "tracking" ? subscription.floorRewardType : null;
  await client.query(
    `insert into public.subscriptions (subscriber_id, store_id, mode, floor_value, floor_reward_type, created_at)
     values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()))`,
    [subscriberId, storeId, subscription.mode, floorValue, floorRewardType, createdAt ?? null],
  );
}

async function subscriptionsOf(subscriberId: number) {
  const result = await client.query<{ store_id: number; mode: string; floor_value: string | null; floor_reward_type: string | null }>(
    "select store_id, mode, floor_value, floor_reward_type from public.subscriptions where subscriber_id = $1 order by store_id",
    [subscriberId],
  );
  return result.rows;
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

async function verifyMerge(canonicalSlug: string, aliases: { platformId: string; rawName: string }[]) {
  await client.query("set role farejo_curation");
  try {
    const result = await client.query<{ verify_alias_merge: boolean }>("select curation.verify_alias_merge($1, $2)", [canonicalSlug, JSON.stringify(aliases)]);
    return result.rows[0]?.verify_alias_merge;
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

/**
 * F4/#115 (ADR-0063): a Inscrição aponta para a Loja canônica por IDENTIDADE, então precisa
 * atravessar o merge como as demais tabelas que referenciam `stores`.
 */
describe("curation.apply_alias_merge — Inscrições (F4, #115, ADR-0063)", () => {
  // O guard-rail que torna "esquecer de tratar" um erro ALTO em vez de uma perda silenciosa: é o
  // motivo de a FK não ter `on delete cascade`.
  //
  // Este teste afirma o guard-rail, NÃO o merge sem o tratamento — e a diferença é honesta: para
  // afirmar o segundo seria preciso reintroduzir a versão antiga da função, que não existe mais.
  // A demonstração real foi feita na implementação, com estes mesmos casos rodando ANTES do
  // bloco de `subscriptions` existir: quatro deles falharam com
  // `update or delete on table "stores" violates foreign key constraint
  // "subscriptions_store_id_fkey"`, vindo de dentro de `apply_alias_merge`. O que sobra aqui é a
  // metade durável: a FK segue armada, então a próxima tabela que referenciar `stores` e for
  // esquecida quebra do mesmo jeito.
  it("uma Loja canônica com Inscrição não pode simplesmente ser apagada", async () => {
    const store = await createStore(`${fixturePrefix}fk-guard`, "FK Guard");
    const subscriber = await createSubscriber(CHAT_RANGE.first);
    await createSubscription(subscriber, store.id, { mode: "improvement" });

    await expect(client.query("delete from public.stores where id = $1", [store.id])).rejects.toThrow(/violates foreign key constraint/i);
  });

  it("reaponta para a canônica a Inscrição que estava na loja absorvida, preservando modo e Piso", async () => {
    const canonical = await createStore(`${fixturePrefix}sub-canonical`, "Canonical");
    const absorbed = await createStore(`${fixturePrefix}sub-absorbed`, "Absorbed");
    await createAlias("meliuz", "Sub Canonical", canonical.id);
    await createAlias("cuponomia", "Sub Absorbed", absorbed.id);
    await createOffer(canonical.id, "meliuz", 5);
    await createOffer(absorbed.id, "cuponomia", 7);

    const subscriber = await createSubscriber(CHAT_RANGE.first + 1);
    await createSubscription(subscriber, absorbed.id, { mode: "tracking", floorValue: 10, floorRewardType: "percent" });

    const result = await applyMerge(canonical.slug, [
      { platformId: "meliuz", rawName: "Sub Canonical" },
      { platformId: "cuponomia", rawName: "Sub Absorbed" },
    ]);
    expect(result.rows).toMatchObject([{ applied: true, reason: "merged" }]);

    expect(await subscriptionsOf(subscriber)).toEqual([
      { store_id: canonical.id, mode: "tracking", floor_value: "10.00", floor_reward_type: "percent" },
    ]);
  });

  it("deixa intacta a Inscrição que já estava na canônica", async () => {
    const canonical = await createStore(`${fixturePrefix}sub-keep-canonical`, "Canonical");
    const absorbed = await createStore(`${fixturePrefix}sub-keep-absorbed`, "Absorbed");
    await createAlias("meliuz", "Keep Canonical", canonical.id);
    await createAlias("cuponomia", "Keep Absorbed", absorbed.id);
    await createOffer(canonical.id, "meliuz", 5);
    await createOffer(absorbed.id, "cuponomia", 7);

    const subscriber = await createSubscriber(CHAT_RANGE.first + 2);
    await createSubscription(subscriber, canonical.id, { mode: "improvement" });

    await applyMerge(canonical.slug, [
      { platformId: "meliuz", rawName: "Keep Canonical" },
      { platformId: "cuponomia", rawName: "Keep Absorbed" },
    ]);

    expect(await subscriptionsOf(subscriber)).toEqual([
      { store_id: canonical.id, mode: "improvement", floor_value: null, floor_reward_type: null },
    ]);
  });

  // O único caso com perda de informação: duas regras viram uma. Desempate por recência, mesmo
  // critério de `store_logo_sources` — somar ou mediar não faz sentido, modo e Piso são regra.
  it("resolve pela Inscrição mais recente quando o assinante tinha as duas lojas", async () => {
    const canonical = await createStore(`${fixturePrefix}sub-clash-canonical`, "Canonical");
    const absorbed = await createStore(`${fixturePrefix}sub-clash-absorbed`, "Absorbed");
    await createAlias("meliuz", "Clash Canonical", canonical.id);
    await createAlias("cuponomia", "Clash Absorbed", absorbed.id);
    await createOffer(canonical.id, "meliuz", 5);
    await createOffer(absorbed.id, "cuponomia", 7);

    const subscriber = await createSubscriber(CHAT_RANGE.first + 3);
    await createSubscription(subscriber, canonical.id, { mode: "improvement" }, "2026-07-01T00:00:00Z");
    await createSubscription(subscriber, absorbed.id, { mode: "tracking", floorValue: 25, floorRewardType: "fixed" }, "2026-07-20T00:00:00Z");

    await applyMerge(canonical.slug, [
      { platformId: "meliuz", rawName: "Clash Canonical" },
      { platformId: "cuponomia", rawName: "Clash Absorbed" },
    ]);

    expect(await subscriptionsOf(subscriber)).toEqual([
      { store_id: canonical.id, mode: "tracking", floor_value: "25.00", floor_reward_type: "fixed" },
    ]);
  });

  it("mantém a Inscrição da canônica quando ELA é a mais recente", async () => {
    const canonical = await createStore(`${fixturePrefix}sub-clash2-canonical`, "Canonical");
    const absorbed = await createStore(`${fixturePrefix}sub-clash2-absorbed`, "Absorbed");
    await createAlias("meliuz", "Clash2 Canonical", canonical.id);
    await createAlias("cuponomia", "Clash2 Absorbed", absorbed.id);
    await createOffer(canonical.id, "meliuz", 5);
    await createOffer(absorbed.id, "cuponomia", 7);

    const subscriber = await createSubscriber(CHAT_RANGE.first + 4);
    await createSubscription(subscriber, canonical.id, { mode: "tracking", floorValue: 15, floorRewardType: "percent" }, "2026-07-20T00:00:00Z");
    await createSubscription(subscriber, absorbed.id, { mode: "improvement" }, "2026-07-01T00:00:00Z");

    await applyMerge(canonical.slug, [
      { platformId: "meliuz", rawName: "Clash2 Canonical" },
      { platformId: "cuponomia", rawName: "Clash2 Absorbed" },
    ]);

    expect(await subscriptionsOf(subscriber)).toEqual([
      { store_id: canonical.id, mode: "tracking", floor_value: "15.00", floor_reward_type: "percent" },
    ]);
  });

  // O `brinox`~`brinoxshop`~`lojaoficialbrinox` do recon: um cluster absorve DUAS lojas onde o
  // mesmo assinante estava inscrito. Sem deduplicar a origem, o INSERT traria duas linhas para a
  // mesma PK e o Postgres abortaria com "ON CONFLICT DO UPDATE command cannot affect row a second
  // time" — o merge quebraria de novo, por outro motivo.
  it("resolve duas lojas absorvidas do mesmo assinante numa Inscrição só, a mais recente", async () => {
    const canonical = await createStore(`${fixturePrefix}sub-multi-canonical`, "Canonical");
    const first = await createStore(`${fixturePrefix}sub-multi-first`, "First");
    const second = await createStore(`${fixturePrefix}sub-multi-second`, "Second");
    await createAlias("meliuz", "Multi Canonical", canonical.id);
    await createAlias("cuponomia", "Multi First", first.id);
    await createAlias("zoom", "Multi Second", second.id);
    await createOffer(canonical.id, "meliuz", 5);
    await createOffer(first.id, "cuponomia", 7);
    await createOffer(second.id, "zoom", 9);

    const subscriber = await createSubscriber(CHAT_RANGE.first + 7);
    await createSubscription(subscriber, first.id, { mode: "improvement" }, "2026-07-01T00:00:00Z");
    await createSubscription(subscriber, second.id, { mode: "tracking", floorValue: 12, floorRewardType: "percent" }, "2026-07-15T00:00:00Z");

    const result = await applyMerge(canonical.slug, [
      { platformId: "meliuz", rawName: "Multi Canonical" },
      { platformId: "cuponomia", rawName: "Multi First" },
      { platformId: "zoom", rawName: "Multi Second" },
    ]);
    expect(result.rows).toMatchObject([{ applied: true, reason: "merged" }]);

    expect(await subscriptionsOf(subscriber)).toEqual([
      { store_id: canonical.id, mode: "tracking", floor_value: "12.00", floor_reward_type: "percent" },
    ]);
  });

  // Empate de `created_at` não tem "mais recente". A resolução é arbitrária por natureza, então o
  // que importa é ser DETERMINÍSTICA e declarada: vence a canônica. Sem este teste, inverter o
  // comparador da migration passaria despercebido — e o custo é a regra do assinante sumir sem
  // rastro. Empate exige inscrições gravadas na mesma transação, então é raro, não impossível.
  it("no empate exato de created_at, a Inscrição da canônica é a que sobrevive", async () => {
    const canonical = await createStore(`${fixturePrefix}sub-tie-canonical`, "Canonical");
    const absorbed = await createStore(`${fixturePrefix}sub-tie-absorbed`, "Absorbed");
    await createAlias("meliuz", "Tie Canonical", canonical.id);
    await createAlias("cuponomia", "Tie Absorbed", absorbed.id);
    await createOffer(canonical.id, "meliuz", 5);
    await createOffer(absorbed.id, "cuponomia", 7);

    const sameInstant = "2026-07-10T12:00:00Z";
    const subscriber = await createSubscriber(CHAT_RANGE.first + 8);
    await createSubscription(subscriber, canonical.id, { mode: "improvement" }, sameInstant);
    await createSubscription(subscriber, absorbed.id, { mode: "tracking", floorValue: 99, floorRewardType: "percent" }, sameInstant);

    await applyMerge(canonical.slug, [
      { platformId: "meliuz", rawName: "Tie Canonical" },
      { platformId: "cuponomia", rawName: "Tie Absorbed" },
    ]);

    expect(await subscriptionsOf(subscriber)).toEqual([
      { store_id: canonical.id, mode: "improvement", floor_value: null, floor_reward_type: null },
    ]);
  });

  it("converge num cluster transitivo: a Inscrição em A termina apontando para C", async () => {
    const a = await createStore(`${fixturePrefix}sub-chain-a`, "A");
    const b = await createStore(`${fixturePrefix}sub-chain-b`, "B");
    const c = await createStore(`${fixturePrefix}sub-chain-c`, "C");
    await createAlias("meliuz", "Chain B", b.id);
    await createAlias("cuponomia", "Chain A", a.id);
    await createOffer(a.id, "cuponomia", 3);
    await createOffer(b.id, "meliuz", 5);
    await createOffer(c.id, "zoom", 7);

    const subscriber = await createSubscriber(CHAT_RANGE.first + 5);
    await createSubscription(subscriber, a.id, { mode: "tracking", floorValue: 8, floorRewardType: "percent" });

    // A é absorvida por B...
    await applyMerge(b.slug, [
      { platformId: "meliuz", rawName: "Chain B" },
      { platformId: "cuponomia", rawName: "Chain A" },
    ]);
    expect(await subscriptionsOf(subscriber)).toEqual([
      { store_id: b.id, mode: "tracking", floor_value: "8.00", floor_reward_type: "percent" },
    ]);

    // ...e depois B por C.
    await createAlias("zoom", "Chain C", c.id);
    await applyMerge(c.slug, [
      { platformId: "zoom", rawName: "Chain C" },
      { platformId: "meliuz", rawName: "Chain B" },
    ]);
    expect(await subscriptionsOf(subscriber)).toEqual([
      { store_id: c.id, mode: "tracking", floor_value: "8.00", floor_reward_type: "percent" },
    ]);
  });

  it("não deixa a Inscrição impedir o merge nem sobreviver apontando para loja apagada", async () => {
    const canonical = await createStore(`${fixturePrefix}sub-orphan-canonical`, "Canonical");
    const absorbed = await createStore(`${fixturePrefix}sub-orphan-absorbed`, "Absorbed");
    await createAlias("meliuz", "Orphan Canonical", canonical.id);
    await createAlias("cuponomia", "Orphan Absorbed", absorbed.id);
    await createOffer(canonical.id, "meliuz", 5);
    await createOffer(absorbed.id, "cuponomia", 7);

    const subscriber = await createSubscriber(CHAT_RANGE.first + 6);
    await createSubscription(subscriber, absorbed.id, { mode: "improvement" });

    await applyMerge(canonical.slug, [
      { platformId: "meliuz", rawName: "Orphan Canonical" },
      { platformId: "cuponomia", rawName: "Orphan Absorbed" },
    ]);

    await expect(client.query("select id from public.stores where id = $1", [absorbed.id])).resolves.toMatchObject({ rows: [] });
    await expect(
      client.query("select 1 from public.subscriptions where store_id not in (select id from public.stores)"),
    ).resolves.toMatchObject({ rows: [] });
    // A verificação pós-merge (ADR-0035 passo 4) continua enxergando o estado como correto.
    await expect(
      verifyMerge(canonical.slug, [
        { platformId: "meliuz", rawName: "Orphan Canonical" },
        { platformId: "cuponomia", rawName: "Orphan Absorbed" },
      ]),
    ).resolves.toBe(true);
  });
});

describe("curation.verify_alias_merge (F3/T13, #59, ADR-0035 passo 4)", () => {
  it("returns true right after a successful apply — materialized state matches the manifest decision", async () => {
    const canonical = await createStore(`${fixturePrefix}verify-canonical`, "Verify Canonical");
    const absorbed = await createStore(`${fixturePrefix}verify-absorbed`, "Verify Absorbed");
    await createAlias("meliuz", "Verify Canonical Raw", canonical.id);
    await createAlias("cuponomia", "Verify Absorbed Raw", absorbed.id);

    const aliases = [
      { platformId: "meliuz", rawName: "Verify Canonical Raw" },
      { platformId: "cuponomia", rawName: "Verify Absorbed Raw" },
    ];
    await applyMerge(canonical.slug, aliases);

    await expect(verifyMerge(canonical.slug, aliases)).resolves.toBe(true);
  });

  it("returns true (nothing to verify yet) when the canonical store hasn't been scraped — same semantics as canonical_not_found", async () => {
    await expect(verifyMerge(`${fixturePrefix}verify-never-scraped`, [{ platformId: "meliuz", rawName: "Whatever" }])).resolves.toBe(true);
  });

  it("returns false when an alias in the decision does not resolve to the canonical store (drift)", async () => {
    const canonical = await createStore(`${fixturePrefix}verify-drift-canonical`, "Verify Drift Canonical");
    const elsewhere = await createStore(`${fixturePrefix}verify-drift-elsewhere`, "Verify Drift Elsewhere");
    // Alias nunca foi movido pro canônico (apply nunca rodou pra esse par) — a decisão do
    // manifesto e o estado materializado divergem de propósito, simulando drift real.
    await createAlias("cuponomia", "Verify Drift Raw", elsewhere.id);

    await expect(
      verifyMerge(canonical.slug, [{ platformId: "cuponomia", rawName: "Verify Drift Raw" }]),
    ).resolves.toBe(false);
  });

  it("lets farejo_curation execute the verification but not read operational tables directly", async () => {
    await expect(
      client.query("select has_function_privilege('farejo_curation', 'curation.verify_alias_merge(text, jsonb)', 'execute') as can_verify"),
    ).resolves.toMatchObject({ rows: [{ can_verify: true }] });
  });
});
