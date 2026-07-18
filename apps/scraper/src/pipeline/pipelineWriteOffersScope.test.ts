import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { localSupabaseClient } from "../testDb.js";
import type { PreparedOfferRow } from "./run.js";

/**
 * T3/#15 — testa `pipeline_write_offers` diretamente via RPC (não via `runPipeline`/`writeOffers`,
 * que ainda só conhecem escopo "full" — a integração com `p_scope_store_ids` real é T4/#16).
 * Aqui o alvo é a função SQL em si: a guarda de `p_scope_store_ids`, a distinção null vs []
 * e a query do agendador sobre `crawl_state` (ADR-0004).
 */
const client = localSupabaseClient();

const PLATFORM_ID = "test-t15";

function row(storeId: number, rawText: string, extra: Partial<PreparedOfferRow> = {}): PreparedOfferRow {
  return {
    store_id: storeId,
    reward_type: "percent",
    value: 5,
    value_partial: null,
    is_upto: false,
    raw_text: rawText,
    url: `https://example.test/${storeId}`,
    previous_reward_type: null,
    previous_value: null,
    previous_raw_text: null,
    ...extra,
  };
}

async function createStore(slug: string, name: string): Promise<number> {
  const { data, error } = await client.from("stores").insert({ slug, name }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function writeOffers(
  runStartedAt: Date,
  offers: PreparedOfferRow[],
  scopeStoreIds: number[] | null | undefined,
) {
  // O tipo gerado (`supabase gen types`) não expõe `null` para um parâmetro `bigint[]`
  // opcional com default — só `number[] | undefined`. `null` é exatamente o caso que este
  // teste precisa exercitar (a guarda do ADR-0004), daí o cast.
  return client.rpc("pipeline_write_offers", {
    p_platform_id: PLATFORM_ID,
    p_run_started_at: runStartedAt.toISOString(),
    p_offers: offers,
    ...(scopeStoreIds === undefined ? {} : { p_scope_store_ids: scopeStoreIds }),
  } as { p_platform_id: string; p_run_started_at: string; p_offers: PreparedOfferRow[]; p_scope_store_ids?: number[] });
}

async function isActive(storeId: number): Promise<boolean> {
  const { data, error } = await client
    .from("offers")
    .select("active")
    .eq("store_id", storeId)
    .eq("platform_id", PLATFORM_ID)
    .single();
  if (error) throw error;
  return data.active ?? false;
}

describe("pipeline_write_offers — p_scope_store_ids (T3/#15, Postgres local)", () => {
  beforeEach(async () => {
    const { error } = await client
      .from("platforms")
      .upsert({ id: PLATFORM_ID, name: "Test T15", base_url: "https://t15.test" });
    if (error) throw error;
  });

  afterAll(async () => {
    const { data: aliases } = await client.from("store_aliases").select("store_id").eq("platform_id", PLATFORM_ID);
    const storeIds = [...new Set((aliases ?? []).map((a) => a.store_id).filter((id): id is number => id != null))];

    await client.from("crawl_state").delete().eq("platform_id", PLATFORM_ID);
    await client.from("offer_history").delete().eq("platform_id", PLATFORM_ID);
    await client.from("offers").delete().eq("platform_id", PLATFORM_ID);
    await client.from("store_aliases").delete().eq("platform_id", PLATFORM_ID);

    // Testes deste arquivo criam stores direto (sem passar por store_aliases) — apaga por prefixo.
    const { data: strayStores } = await client.from("stores").select("id").like("slug", "t15%");
    const strayIds = (strayStores ?? []).map((s) => s.id);
    if (strayIds.length > 0) await client.from("stores").delete().in("id", strayIds);
    if (storeIds.length > 0) await client.from("stores").delete().in("id", storeIds);

    await client.from("platforms").delete().eq("id", PLATFORM_ID);
  });

  it("null preserva a desativação de plataforma inteira quando a plataforma não usa crawl_state (comportamento da Fase 1)", async () => {
    const run1 = new Date("2026-07-10T03:00:00Z");
    const run2 = new Date("2026-07-10T15:00:00Z");
    const storeId = await createStore("t15-null-scope", "Null Scope T15");

    const { error: e1 } = await writeOffers(run1, [row(storeId, "6% cashback")], null);
    expect(e1).toBeNull();
    expect(await isActive(storeId)).toBe(true);

    // run2 não traz mais essa oferta e passa p_scope_store_ids=null explicitamente — sem
    // linhas em crawl_state para esta plataforma, a guarda não dispara e a desativação
    // por ausência cobre a plataforma inteira, como na Fase 1.
    const { error: e2 } = await writeOffers(run2, [], null);
    expect(e2).toBeNull();
    expect(await isActive(storeId)).toBe(false);
  });

  it("levanta exceção se a plataforma tem linha em crawl_state e p_scope_store_ids vem null", async () => {
    const { error: crawlStateError } = await client
      .from("crawl_state")
      .upsert({ platform_id: PLATFORM_ID, slug: "guarded-slug", tier: "tail" });
    expect(crawlStateError).toBeNull();

    const { error } = await writeOffers(new Date("2026-07-10T03:00:00Z"), [], null);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("p_scope_store_ids");
  });

  it("array vazio ([]) desativa nada — não é tratado como null", async () => {
    const run1 = new Date("2026-07-10T03:00:00Z");
    const run2 = new Date("2026-07-10T15:00:00Z");
    const storeId = await createStore("t15-empty-scope", "Empty Scope T15");

    await client.from("crawl_state").upsert({
      platform_id: PLATFORM_ID,
      slug: "empty-scope-slug",
      store_id: storeId,
      tier: "active",
    });

    const { error: e1 } = await writeOffers(run1, [row(storeId, "6% cashback")], [storeId]);
    expect(e1).toBeNull();
    expect(await isActive(storeId)).toBe(true);

    // Run inteiramente bloqueado (soft_block): nenhum store_id resolvido, escopo chega como
    // [], nunca coalescido para null. A oferta pré-existente, fora do escopo vazio, sobrevive.
    const { error: e2 } = await writeOffers(run2, [], []);
    expect(e2).toBeNull();
    expect(await isActive(storeId)).toBe(true);
  });

  it("bootstrap retomado: dispatch 2 não desativa as ofertas escritas pelo dispatch 1", async () => {
    const dispatch1Start = new Date("2026-07-10T03:00:00Z");
    const dispatch2Start = new Date("2026-07-10T03:30:00Z");
    const storeA = await createStore("t15-bootstrap-a", "Bootstrap A T15");
    const storeB = await createStore("t15-bootstrap-b", "Bootstrap B T15");

    await client.from("crawl_state").upsert([
      { platform_id: PLATFORM_ID, slug: "slug-a", store_id: storeA, tier: "active" },
      { platform_id: PLATFORM_ID, slug: "slug-b", store_id: storeB, tier: "active" },
    ]);

    // Dispatch 1 (slugs 1-200, aqui só slug-a): escreve e restringe a desativação ao que
    // ele mesmo visitou.
    const { error: e1 } = await writeOffers(dispatch1Start, [row(storeA, "5% cashback")], [storeA]);
    expect(e1).toBeNull();

    // Dispatch 2 (slugs 201-400, aqui só slug-b), iniciado DEPOIS de dispatch1Start: sua
    // oferta escrita tem last_seen_at = dispatch2Start > dispatch1Start, então a oferta de A
    // (last_seen_at = dispatch1Start < dispatch2Start) ficaria fora do escopo de A por
    // ausência SE o escopo fosse a plataforma inteira — mas o escopo de dispatch2 é só [storeB].
    const { error: e2 } = await writeOffers(dispatch2Start, [row(storeB, "5% cashback")], [storeB]);
    expect(e2).toBeNull();

    expect(await isActive(storeA)).toBe(true);
    expect(await isActive(storeB)).toBe(true);
  });

  it("run scope='active' não desativa uma oferta residual de loja tier='tail'", async () => {
    const tailRunStart = new Date("2026-07-10T03:00:00Z");
    const activeRunStart = new Date("2026-07-10T15:00:00Z");
    const activeStore = await createStore("t15-active-tier", "Active Tier T15");
    const tailStore = await createStore("t15-tail-tier", "Tail Tier T15");

    await client.from("crawl_state").upsert([
      { platform_id: PLATFORM_ID, slug: "active-slug", store_id: activeStore, tier: "active" },
      { platform_id: PLATFORM_ID, slug: "tail-slug", store_id: tailStore, tier: "tail" },
    ]);

    // Loja tail ganha uma oferta residual, escopo restrito a ela mesma (simula o run da
    // fatia da cauda de um dia anterior).
    const { error: e1 } = await writeOffers(tailRunStart, [row(tailStore, "3% cashback")], [tailStore]);
    expect(e1).toBeNull();

    // Run scope='active' do dia seguinte: toca só o tier ativo, nunca a loja tail.
    const { error: e2 } = await writeOffers(activeRunStart, [row(activeStore, "9% cashback")], [activeStore]);
    expect(e2).toBeNull();

    expect(await isActive(activeStore)).toBe(true);
    expect(await isActive(tailStore)).toBe(true);
  });

  it("a query do agendador (ORDER BY last_checked_at NULLS FIRST) traz os slugs nunca visitados primeiro", async () => {
    await client.from("crawl_state").upsert([
      { platform_id: PLATFORM_ID, slug: "scheduler-checked-old", tier: "tail", last_checked_at: "2026-07-01T00:00:00Z" },
      { platform_id: PLATFORM_ID, slug: "scheduler-never-1", tier: "tail", last_checked_at: null },
      { platform_id: PLATFORM_ID, slug: "scheduler-checked-new", tier: "tail", last_checked_at: "2026-07-09T00:00:00Z" },
      { platform_id: PLATFORM_ID, slug: "scheduler-never-2", tier: "tail", last_checked_at: null },
    ]);

    const { data, error } = await client
      .from("crawl_state")
      .select("slug, last_checked_at")
      .eq("platform_id", PLATFORM_ID)
      .eq("tier", "tail")
      .like("slug", "scheduler-%")
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(3);

    expect(error).toBeNull();
    const slugs = data!.map((r) => r.slug);
    // Os dois nunca visitados (last_checked_at null) vêm antes de qualquer slug já checado —
    // vencidos por definição, independente de há quanto tempo o checado foi visto.
    expect(slugs).toEqual(
      expect.arrayContaining(["scheduler-never-1", "scheduler-never-2", "scheduler-checked-old"]),
    );
    expect(slugs).not.toContain("scheduler-checked-new");
    expect(data!.slice(0, 2).every((r) => r.last_checked_at === null)).toBe(true);
  });
});
