import { l2Key, type RawOffer, type ScrapeResult, type SlugOutcome } from "@farejo/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localSupabaseClient } from "../testDb.js";
import { runPipeline } from "./run.js";

/**
 * T4/#16 — sincronização de crawl_state (promoção/demoção de tier) na mesma transação
 * da escrita das ofertas. `SlugOutcome[]` construído à mão, sem depender de nenhum
 * adapter tiered real (cuponomia/méliuz ainda não existem — T5/T6).
 */
const client = localSupabaseClient();

const PLATFORM_ID = "test-t16";

function offer(storeName: string, rewardText: string, extra: Partial<RawOffer> = {}): RawOffer {
  return { storeName, rewardText, url: `https://example.test/${storeName}`, ...extra };
}

function tieredResult(outcomes: SlugOutcome[]): ScrapeResult {
  return {
    offers: outcomes.filter((o) => o.outcome === "offer").map((o) => o.offer),
    scope: { kind: "partial", slugs: new Set(outcomes.map((o) => o.slug)) },
    rawCount: outcomes.length,
    softBlocks: outcomes.filter((o) => o.outcome === "soft_block").length,
    outcomes,
  };
}

async function storeIdFor(storeName: string): Promise<number> {
  const { data, error } = await client.from("stores").select("id").eq("slug", l2Key(storeName)).single();
  if (error) throw error;
  return data.id;
}

async function crawlStateFor(slug: string) {
  const { data, error } = await client
    .from("crawl_state")
    .select("*")
    .eq("platform_id", PLATFORM_ID)
    .eq("slug", slug)
    .single();
  if (error) throw error;
  return data;
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

describe("runPipeline — sincronização de crawl_state (T4/#16, Postgres local)", () => {
  beforeAll(async () => {
    const { error } = await client
      .from("platforms")
      .upsert({ id: PLATFORM_ID, name: "Test T16", base_url: "https://t16.test" });
    if (error) throw error;
  });

  afterAll(async () => {
    const { data: aliases } = await client.from("store_aliases").select("store_id").eq("platform_id", PLATFORM_ID);
    const storeIds = [...new Set((aliases ?? []).map((a) => a.store_id).filter((id): id is number => id != null))];

    await client.from("crawl_state").delete().eq("platform_id", PLATFORM_ID);
    await client.from("offer_history").delete().eq("platform_id", PLATFORM_ID);
    await client.from("offers").delete().eq("platform_id", PLATFORM_ID);
    await client.from("store_aliases").delete().eq("platform_id", PLATFORM_ID);
    if (storeIds.length > 0) await client.from("stores").delete().in("id", storeIds);
    await client.from("platforms").delete().eq("id", PLATFORM_ID);
  });

  it("outcome='offer' escreve a oferta e promove crawl_state.tier para active, gravando o store_id resolvido", async () => {
    const runStartedAt = new Date("2026-07-12T03:00:00Z");
    const storeName = "Loja Promovida T16";

    await client.from("crawl_state").upsert({ platform_id: PLATFORM_ID, slug: "slug-promovida", tier: "tail" });

    const result = await runPipeline(
      client,
      PLATFORM_ID,
      tieredResult([{ slug: "slug-promovida", outcome: "offer", offer: offer(storeName, "6% cashback") }]),
      runStartedAt,
    );
    expect(result).toMatchObject({ offersWritten: 1, parseErrors: 0 });

    const storeId = await storeIdFor(storeName);
    expect(await isActive(storeId)).toBe(true);

    const crawlState = await crawlStateFor("slug-promovida");
    expect(crawlState).toMatchObject({ tier: "active", store_id: storeId, last_outcome: "offer" });
    expect(new Date(crawlState.last_checked_at!).getTime()).toBe(runStartedAt.getTime());
  });

  it("outcome='no_cashback' demove tier para tail e desativa a oferta ativa existente para o store_id", async () => {
    const run1 = new Date("2026-07-12T03:00:00Z");
    const run2 = new Date("2026-07-12T15:00:00Z");
    const storeName = "Loja Demovida T16";

    await client.from("crawl_state").upsert({ platform_id: PLATFORM_ID, slug: "slug-demovida", tier: "tail" });

    // Run 1: offer promove a active e cria a oferta.
    await runPipeline(
      client,
      PLATFORM_ID,
      tieredResult([{ slug: "slug-demovida", outcome: "offer", offer: offer(storeName, "5% cashback") }]),
      run1,
    );
    const storeId = await storeIdFor(storeName);
    expect(await isActive(storeId)).toBe(true);

    // Run 2: a mesma loja revela no_cashback — demove pra tail E desativa a oferta,
    // mesmo sem RawOffer nenhum nesse desfecho (store_id vem de crawl_state, não de find-or-create).
    const result2 = await runPipeline(
      client,
      PLATFORM_ID,
      tieredResult([{ slug: "slug-demovida", outcome: "no_cashback" }]),
      run2,
    );
    expect(result2.offersWritten).toBe(0);

    expect(await isActive(storeId)).toBe(false);

    const crawlState = await crawlStateFor("slug-demovida");
    expect(crawlState).toMatchObject({ tier: "tail", last_outcome: "no_cashback", store_id: storeId });
    expect(new Date(crawlState.last_checked_at!).getTime()).toBe(run2.getTime());
  });

  it("outcome='soft_block' nunca atualiza crawl_state — nem tier nem last_checked_at", async () => {
    const staleCheck = new Date("2026-07-01T00:00:00Z");
    const runStartedAt = new Date("2026-07-12T03:00:00Z");

    await client.from("crawl_state").upsert({
      platform_id: PLATFORM_ID,
      slug: "slug-bloqueada",
      tier: "tail",
      last_outcome: "no_cashback",
      last_checked_at: staleCheck.toISOString(),
    });

    const result = await runPipeline(
      client,
      PLATFORM_ID,
      tieredResult([{ slug: "slug-bloqueada", outcome: "soft_block" }]),
      runStartedAt,
    );
    expect(result.offersWritten).toBe(0);

    const crawlState = await crawlStateFor("slug-bloqueada");
    expect(crawlState).toMatchObject({ tier: "tail", last_outcome: "no_cashback" });
    expect(new Date(crawlState.last_checked_at!).getTime()).toBe(staleCheck.getTime());
  });

  it("crawl_state.store_id, uma vez gravado no primeiro offer, é retido em desfechos posteriores", async () => {
    const run1 = new Date("2026-07-12T03:00:00Z");
    const run2 = new Date("2026-07-12T09:00:00Z");
    const run3 = new Date("2026-07-12T15:00:00Z");
    const storeName = "Loja Retida T16";

    await client.from("crawl_state").upsert({ platform_id: PLATFORM_ID, slug: "slug-retida", tier: "tail" });

    await runPipeline(
      client,
      PLATFORM_ID,
      tieredResult([{ slug: "slug-retida", outcome: "offer", offer: offer(storeName, "4% cashback") }]),
      run1,
    );
    const storeId = await storeIdFor(storeName);

    await runPipeline(client, PLATFORM_ID, tieredResult([{ slug: "slug-retida", outcome: "no_cashback" }]), run2);
    expect((await crawlStateFor("slug-retida")).store_id).toBe(storeId);

    await runPipeline(client, PLATFORM_ID, tieredResult([{ slug: "slug-retida", outcome: "not_found" }]), run3);
    expect((await crawlStateFor("slug-retida")).store_id).toBe(storeId);
  });

  it("p_scope_store_ids é a união de ofertas escritas + crawl_state.store_id de no_cashback/not_found, excluindo soft_block", async () => {
    const run1 = new Date("2026-07-12T03:00:00Z");
    const run2 = new Date("2026-07-12T15:00:00Z");
    const newStoreName = "Loja Nova Escopo T16";
    const droppedStoreName = "Loja Cai Escopo T16";
    const blockedStoreName = "Loja Bloqueada Escopo T16";
    const untouchedStoreName = "Loja Fora Escopo T16";

    // Semeia 3 lojas já com oferta ativa via runs anteriores (fora do run que o teste mede).
    await client
      .from("crawl_state")
      .upsert([
        { platform_id: PLATFORM_ID, slug: "slug-cai", tier: "active" },
        { platform_id: PLATFORM_ID, slug: "slug-bloqueada-escopo", tier: "active" },
        { platform_id: PLATFORM_ID, slug: "slug-fora", tier: "active" },
      ]);
    await runPipeline(
      client,
      PLATFORM_ID,
      tieredResult([
        { slug: "slug-cai", outcome: "offer", offer: offer(droppedStoreName, "5% cashback") },
        { slug: "slug-bloqueada-escopo", outcome: "offer", offer: offer(blockedStoreName, "5% cashback") },
        { slug: "slug-fora", outcome: "offer", offer: offer(untouchedStoreName, "5% cashback") },
      ]),
      run1,
    );
    const droppedStoreId = await storeIdFor(droppedStoreName);
    const blockedStoreId = await storeIdFor(blockedStoreName);
    const untouchedStoreId = await storeIdFor(untouchedStoreName);

    // Run 2: só toca slug-nova (offer), slug-cai (no_cashback) e slug-bloqueada-escopo
    // (soft_block). slug-fora não está no run 2 — fora do escopo, tem que sobreviver.
    const result2 = await runPipeline(
      client,
      PLATFORM_ID,
      tieredResult([
        { slug: "slug-nova", outcome: "offer", offer: offer(newStoreName, "8% cashback") },
        { slug: "slug-cai", outcome: "no_cashback" },
        { slug: "slug-bloqueada-escopo", outcome: "soft_block" },
      ]),
      run2,
    );
    expect(result2.offersWritten).toBe(1);

    const newStoreId = await storeIdFor(newStoreName);
    expect(await isActive(newStoreId)).toBe(true); // escrita nova, dentro do escopo
    expect(await isActive(droppedStoreId)).toBe(false); // no_cashback: desativada via crawl_state.store_id
    expect(await isActive(blockedStoreId)).toBe(true); // soft_block: nunca entra no escopo, sobrevive
    expect(await isActive(untouchedStoreId)).toBe(true); // fora do run 2 inteiramente, sobrevive
  });
});
