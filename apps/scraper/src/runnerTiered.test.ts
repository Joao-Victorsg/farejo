import type { PlatformAdapter, RawOffer, ScrapeInstruction, ScrapeResult, SlugOutcome } from "@farejo/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { CrawlTier } from "./pipeline/crawlStateSlugs.js";
import { runTieredPlatform } from "./runner.js";
import { localSupabaseClient } from "./testDb.js";

/**
 * T11/#23 — capstone da Fase 2: o runner monta `ScrapeInstruction` para cuponomia/méliuz
 * lendo `crawl_state` (a fatia mais vencida do tier pedido) e `platforms.throttle_multiplier`
 * ANTES de chamar `adapter.scrape`, e sincroniza `crawl_state`/`throttle_multiplier`/
 * `scrape_runs.scope` ao fim do run. Adapter fake só — não depende de cuponomia/méliuz reais.
 */
const client = localSupabaseClient();

const PLATFORM_TIERED = "test-t23-tiered";
const PLATFORM_ISOLATION_OK = "test-t23-isolation-ok";
const PLATFORM_ISOLATION_FAIL = "test-t23-isolation-fail";
const ALL_PLATFORMS = [PLATFORM_TIERED, PLATFORM_ISOLATION_OK, PLATFORM_ISOLATION_FAIL];

function offer(storeName: string, rewardText: string): RawOffer {
  return { storeName, rewardText, url: `https://example.test/${storeName}` };
}

function offerOutcome(slug: string, rawOffer: RawOffer): SlugOutcome {
  return { slug, outcome: "offer", offer: rawOffer };
}

function noCashbackOutcome(slug: string): SlugOutcome {
  return { slug, outcome: "no_cashback" };
}

interface FakeTieredAdapter extends PlatformAdapter {
  receivedInstructions: ScrapeInstruction[];
}

/** Adapter fake de coleta tiered: só aceita `target.kind === 'slugs'`, como cuponomia/méliuz reais. */
function tieredAdapter(platformId: string, respond: (slugs: string[]) => SlugOutcome[]): FakeTieredAdapter {
  const receivedInstructions: ScrapeInstruction[] = [];
  return {
    platformId,
    receivedInstructions,
    async scrape(instruction: ScrapeInstruction): Promise<ScrapeResult> {
      receivedInstructions.push(instruction);
      if (instruction.target.kind !== "slugs") throw new Error("esperava instruction.target.kind === 'slugs'");

      const outcomes = respond(instruction.target.slugs);
      return {
        offers: outcomes.flatMap((o) => (o.outcome === "offer" ? [o.offer] : [])),
        scope: { kind: "partial", slugs: new Set(instruction.target.slugs) },
        rawCount: outcomes.length,
        softBlocks: outcomes.filter((o) => o.outcome === "soft_block").length,
        outcomes,
      };
    },
  };
}

async function seedPlatform(platformId: string, throttleMultiplier = 1): Promise<void> {
  const { error } = await client.from("platforms").upsert({
    id: platformId,
    name: platformId,
    base_url: `https://${platformId}.test`,
    throttle_multiplier: throttleMultiplier,
  });
  if (error) throw error;
}

interface CrawlStateSeedRow {
  slug: string;
  tier: CrawlTier;
  last_checked_at?: string | null;
}

async function seedCrawlState(platformId: string, rows: CrawlStateSeedRow): Promise<void>;
async function seedCrawlState(platformId: string, rows: CrawlStateSeedRow[]): Promise<void>;
async function seedCrawlState(platformId: string, rows: CrawlStateSeedRow | CrawlStateSeedRow[]): Promise<void> {
  const list = Array.isArray(rows) ? rows : [rows];
  const { error } = await client.from("crawl_state").upsert(list.map((r) => ({ platform_id: platformId, ...r })));
  if (error) throw error;
}

async function crawlStateFor(platformId: string, slug: string) {
  const { data, error } = await client
    .from("crawl_state")
    .select("*")
    .eq("platform_id", platformId)
    .eq("slug", slug)
    .single();
  if (error) throw error;
  return data;
}

async function throttleMultiplierOf(platformId: string): Promise<number> {
  const { data, error } = await client.from("platforms").select("throttle_multiplier").eq("id", platformId).single();
  if (error) throw error;
  return data.throttle_multiplier;
}

describe("runTieredPlatform (T11/#23, Postgres local)", () => {
  beforeEach(async () => {
    await seedPlatform(PLATFORM_TIERED);
    await seedPlatform(PLATFORM_ISOLATION_OK);
    await seedPlatform(PLATFORM_ISOLATION_FAIL);
  });

  afterAll(async () => {
    const { data: aliases } = await client.from("store_aliases").select("store_id").in("platform_id", ALL_PLATFORMS);
    const storeIds = [...new Set((aliases ?? []).map((a) => a.store_id).filter((id) => id != null))];

    await client.from("crawl_state").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("offer_history").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("offers").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("scrape_runs").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("store_aliases").delete().in("platform_id", ALL_PLATFORMS);
    if (storeIds.length > 0) await client.from("stores").delete().in("id", storeIds);
    await client.from("platforms").delete().in("id", ALL_PLATFORMS);
  });

  it("monta a instrução a partir de crawl_state (NULLS FIRST, respeitando o limit) e platforms.throttle_multiplier", async () => {
    await seedPlatform(PLATFORM_TIERED, 2);
    await seedCrawlState(PLATFORM_TIERED, [
      { slug: "slug-nunca-visitado", tier: "active", last_checked_at: null },
      { slug: "slug-antigo", tier: "active", last_checked_at: "2026-07-01T00:00:00Z" },
      { slug: "slug-recente", tier: "active", last_checked_at: "2026-07-11T00:00:00Z" },
      { slug: "slug-tail-fora-do-tier", tier: "tail", last_checked_at: null },
    ]);

    const adapter = tieredAdapter(PLATFORM_TIERED, (slugs) => slugs.map((slug) => ({ slug, outcome: "no_cashback" })));
    const result = await runTieredPlatform(client, adapter, "active", 2);

    expect(adapter.receivedInstructions).toEqual([
      { throttleMultiplier: 2, target: { kind: "slugs", slugs: ["slug-nunca-visitado", "slug-antigo"] } },
    ]);
    expect(result.status).toBe("ok");
  });

  it("promove/demove crawl_state.tier e grava scrape_runs.scope='tail' ao fim do run", async () => {
    await seedCrawlState(PLATFORM_TIERED, [
      { slug: "slug-promove", tier: "tail", last_checked_at: null },
      { slug: "slug-demove", tier: "tail", last_checked_at: null },
    ]);

    const adapter = tieredAdapter(PLATFORM_TIERED, (slugs) =>
      slugs.map((slug) =>
        slug === "slug-promove"
          ? offerOutcome(slug, offer("Loja T23 Promovida", "6% cashback"))
          : noCashbackOutcome(slug),
      ),
    );
    const runResult = await runTieredPlatform(client, adapter, "tail", 10);
    expect(runResult).toMatchObject({ status: "ok", offersWritten: 1 });

    expect(await crawlStateFor(PLATFORM_TIERED, "slug-promove")).toMatchObject({ tier: "active", last_outcome: "offer" });
    expect(await crawlStateFor(PLATFORM_TIERED, "slug-demove")).toMatchObject({ tier: "tail", last_outcome: "no_cashback" });

    const { data: run, error } = await client
      .from("scrape_runs")
      .select("scope, status")
      .eq("platform_id", PLATFORM_TIERED)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();
    expect(error).toBeNull();
    expect(run).toMatchObject({ scope: "tail", status: "ok" });
  });

  it("sincroniza platforms.throttle_multiplier ao fim de um run tiered (ratio > 5% sobe o multiplier)", async () => {
    await seedPlatform(PLATFORM_TIERED, 1);
    await seedCrawlState(
      PLATFORM_TIERED,
      Array.from({ length: 20 }, (_, i) => ({ slug: `slug-throttle-${i}`, tier: "active" as const, last_checked_at: null })),
    );

    // 2/20 = 10% > riseRatio (5%) → sobe de 1 para 2.
    const adapter = tieredAdapter(PLATFORM_TIERED, (slugs) =>
      slugs.map((slug, i) => (i < 2 ? { slug, outcome: "soft_block" } : { slug, outcome: "no_cashback" })),
    );
    await runTieredPlatform(client, adapter, "active", 20);

    expect(await throttleMultiplierOf(PLATFORM_TIERED)).toBe(2);
  });

  it("sincroniza platforms.throttle_multiplier ao fim de um run tiered limpo (ratio < 2% desce o multiplier)", async () => {
    await seedPlatform(PLATFORM_TIERED, 4);
    await seedCrawlState(
      PLATFORM_TIERED,
      Array.from({ length: 20 }, (_, i) => ({ slug: `slug-descend-${i}`, tier: "active" as const, last_checked_at: null })),
    );

    // 0/20 = 0% < fallRatio (2%) → desce de 4 para 2.
    const adapter = tieredAdapter(PLATFORM_TIERED, (slugs) => slugs.map((slug) => ({ slug, outcome: "no_cashback" })));
    await runTieredPlatform(client, adapter, "active", 20);

    expect(await throttleMultiplierOf(PLATFORM_TIERED)).toBe(2);
  });

  it("isolamento: uma plataforma tiered falhando não impede outra de gravar", async () => {
    await seedCrawlState(PLATFORM_ISOLATION_OK, { slug: "slug-ok", tier: "active", last_checked_at: null });
    await seedCrawlState(PLATFORM_ISOLATION_FAIL, { slug: "slug-fail", tier: "active", last_checked_at: null });

    const okAdapter = tieredAdapter(PLATFORM_ISOLATION_OK, (slugs) =>
      slugs.map((slug) => ({ slug, outcome: "offer", offer: offer("Loja T23 Isolada", "5% cashback") })),
    );
    const failingAdapter: PlatformAdapter = {
      platformId: PLATFORM_ISOLATION_FAIL,
      async scrape(): Promise<ScrapeResult> {
        throw new Error("simulated network exhaustion");
      },
    };

    const [okResult, failResult] = await Promise.all([
      runTieredPlatform(client, okAdapter, "active", 10),
      runTieredPlatform(client, failingAdapter, "active", 10),
    ]);

    expect(okResult).toMatchObject({ status: "ok", offersWritten: 1, error: null });
    expect(failResult).toMatchObject({ status: "failed", offersWritten: 0 });
    expect(failResult.error).toContain("simulated network exhaustion");

    const { data: okRun } = await client.from("scrape_runs").select("*").eq("platform_id", PLATFORM_ISOLATION_OK).single();
    expect(okRun).toMatchObject({ status: "ok", scope: "active", offers_found: 1, active_offers: 1 });

    const { data: failRun } = await client
      .from("scrape_runs")
      .select("*")
      .eq("platform_id", PLATFORM_ISOLATION_FAIL)
      .single();
    expect(failRun).toMatchObject({ status: "failed", scope: "active" });
  });
});
