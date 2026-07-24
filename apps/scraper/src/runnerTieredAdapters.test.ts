import type { PlatformAdapter, ScrapeInstruction, ScrapeResult } from "@farejo/shared";
import { loadFixture } from "@farejo/test-fixtures";
import { afterAll, describe, expect, it } from "vitest";
import { scrapeCuponomiaSlugs } from "./cuponomia.js";
import { parseInter } from "./inter.js";
import { scrapeMeliuzSlugs } from "./meliuz.js";
import { parseMycashback } from "./mycashback.js";
import { runAllPlatforms, runTieredPlatform } from "./runner.js";
import { localSupabaseClient } from "./testDb.js";
import { parseZoom } from "./zoom.js";

/**
 * T11/#23 — prova que a fatia tiered funciona ponta a ponta com o PARSER REAL de
 * cuponomia/méliuz (não um adapter fake), da mesma forma que `cuponomia.test.ts`/
 * `meliuz.test.ts` já testam `scrapeCuponomiaSlugs`/`scrapeMeliuzSlugs` isoladas: injeta
 * `fetchPage` contra fixture HTML (nunca a rede), mas deixa o parser, o circuit breaker,
 * `runTieredPlatform` e o gate de sanity (`runPlatformScrape`, com sincronização de
 * `crawl_state`/`throttle_multiplier`) rodarem sem stub nenhum. Só o `platformId` é de
 * teste — não toca as linhas seed de "cuponomia"/"méliuz" usadas em produção.
 */
const client = localSupabaseClient();

const PLATFORM_CUPONOMIA = "test-t23-cuponomia-real";
const PLATFORM_MELIUZ = "test-t23-meliuz-real";
const PLATFORM_INTER = "test-t23-inter-real";
const PLATFORM_MYCASHBACK = "test-t23-mycashback-real";
const PLATFORM_ZOOM = "test-t23-zoom-real";
const ALL_PLATFORMS = [PLATFORM_CUPONOMIA, PLATFORM_MELIUZ, PLATFORM_INTER, PLATFORM_MYCASHBACK, PLATFORM_ZOOM];

const instantSleep = async (_ms: number): Promise<void> => {};

function fixtureCuponomiaAdapter(htmlBySlug: Record<string, string>): PlatformAdapter {
  return {
    platformId: PLATFORM_CUPONOMIA,
    scrape: (instruction: ScrapeInstruction) =>
      scrapeCuponomiaSlugs(instruction, {
        fetchPage: async (slug) => htmlBySlug[slug] ?? "<html><body>não usado</body></html>",
        sleep: instantSleep,
      }),
  };
}

function fixtureMeliuzAdapter(htmlBySlug: Record<string, string>): PlatformAdapter {
  return {
    platformId: PLATFORM_MELIUZ,
    scrape: (instruction: ScrapeInstruction) =>
      scrapeMeliuzSlugs(instruction, {
        fetchPage: async (slug) => htmlBySlug[slug] ?? "<html><body>não usado</body></html>",
        sleep: instantSleep,
      }),
  };
}

function fixtureFullAdapter(platformId: string, result: ScrapeResult): PlatformAdapter {
  return { platformId, scrape: async () => result };
}

async function seedPlatform(platformId: string): Promise<void> {
  const { error } = await client
    .from("platforms")
    .upsert({ id: platformId, name: platformId, base_url: `https://${platformId}.test` });
  if (error) throw error;
}

async function seedCrawlState(platformId: string, slug: string): Promise<void> {
  const { error } = await client.from("crawl_state").upsert({ platform_id: platformId, slug, tier: "tail" });
  if (error) throw error;
}

describe("runTieredPlatform — parser real de cuponomia/méliuz contra fixture (T11/#23, Postgres local)", () => {
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

  it("cuponomia: grava a oferta real da fixture (iPlace, boost) via runTieredPlatform, sem tocar a rede", async () => {
    await seedPlatform(PLATFORM_CUPONOMIA);
    await seedCrawlState(PLATFORM_CUPONOMIA, "iplace");

    const adapter = fixtureCuponomiaAdapter({ iplace: loadFixture("cuponomia-loja-boost.html") });
    const result = await runTieredPlatform(client, adapter, "tail", 10);
    expect(result).toMatchObject({ status: "ok", offersWritten: 1, parseErrors: 0 });

    const { data: offerRow, error } = await client
      .from("offers")
      .select("raw_text, active, url")
      .eq("platform_id", PLATFORM_CUPONOMIA)
      .single();
    expect(error).toBeNull();
    expect(offerRow).toMatchObject({
      raw_text: "1,5% de cashback",
      active: true,
      url: "https://www.cuponomia.com.br/desconto/iplace",
    });

    const { data: crawlState } = await client
      .from("crawl_state")
      .select("tier, last_outcome")
      .eq("platform_id", PLATFORM_CUPONOMIA)
      .eq("slug", "iplace")
      .single();
    expect(crawlState).toMatchObject({ tier: "active", last_outcome: "offer" });
  });

  it("méliuz: grava a oferta real da fixture (Magazine Luiza, up-to) via runTieredPlatform, sem tocar a rede", async () => {
    await seedPlatform(PLATFORM_MELIUZ);
    await seedCrawlState(PLATFORM_MELIUZ, "cupom-magazine-luiza");

    const adapter = fixtureMeliuzAdapter({ "cupom-magazine-luiza": loadFixture("meliuz-loja.html") });
    const result = await runTieredPlatform(client, adapter, "tail", 10);
    expect(result).toMatchObject({ status: "ok", offersWritten: 1, parseErrors: 0 });

    const { data: offerRow, error } = await client
      .from("offers")
      .select("raw_text, active, url")
      .eq("platform_id", PLATFORM_MELIUZ)
      .single();
    expect(error).toBeNull();
    expect(offerRow).toMatchObject({
      raw_text: "até 10% de cashback",
      active: true,
      url: "https://www.meliuz.com.br/desconto/cupom-magazine-luiza",
    });

    const { data: crawlState } = await client
      .from("crawl_state")
      .select("tier, last_outcome")
      .eq("platform_id", PLATFORM_MELIUZ)
      .eq("slug", "cupom-magazine-luiza")
      .single();
    expect(crawlState).toMatchObject({ tier: "active", last_outcome: "offer" });
  });

  it("executa as cinco plataformas com fixtures reais e grava ofertas para cada uma", async () => {
    await Promise.all([PLATFORM_INTER, PLATFORM_MYCASHBACK, PLATFORM_ZOOM].map(seedPlatform));
    await seedPlatform(PLATFORM_CUPONOMIA);
    await seedPlatform(PLATFORM_MELIUZ);
    await seedCrawlState(PLATFORM_CUPONOMIA, "iplace");
    await seedCrawlState(PLATFORM_MELIUZ, "cupom-magazine-luiza");

    const fullAdapters = [
      fixtureFullAdapter(PLATFORM_INTER, parseInter(loadFixture("inter-stores.api.json"))),
      fixtureFullAdapter(PLATFORM_MYCASHBACK, parseMycashback(loadFixture("mycashback-all-shops.html"))),
      fixtureFullAdapter(PLATFORM_ZOOM, parseZoom(loadFixture("zoom-lojas.html"))),
    ];
    const cuponomia = fixtureCuponomiaAdapter({ iplace: loadFixture("cuponomia-loja-boost.html") });
    const meliuz = fixtureMeliuzAdapter({ "cupom-magazine-luiza": loadFixture("meliuz-loja.html") });

    const [fullResults, cuponomiaResult, meliuzResult] = await Promise.all([
      runAllPlatforms(client, fullAdapters),
      runTieredPlatform(client, cuponomia, "tail", 10),
      runTieredPlatform(client, meliuz, "tail", 10),
    ]);

    expect([...fullResults, cuponomiaResult, meliuzResult]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platformId: PLATFORM_INTER, status: "ok" }),
        expect.objectContaining({ platformId: PLATFORM_MYCASHBACK, status: "ok" }),
        expect.objectContaining({ platformId: PLATFORM_ZOOM, status: "ok" }),
        expect.objectContaining({ platformId: PLATFORM_CUPONOMIA, status: "ok" }),
        expect.objectContaining({ platformId: PLATFORM_MELIUZ, status: "ok" }),
      ]),
    );

    const { data: offers, error } = await client.from("offers").select("platform_id").in("platform_id", ALL_PLATFORMS);
    expect(error).toBeNull();
    expect(new Set((offers ?? []).map((offer) => offer.platform_id))).toEqual(new Set(ALL_PLATFORMS));
    // 30s, não 15s: este é o teste mais pesado da suíte (seed de 5 plataformas + parse de HTML
    // real de mycashback/zoom + 5 runs completos). Os 15s originais estouravam sob a CPU escassa
    // do runner de CI (2 cores), embora localmente rode em ~10s. Teto alto absorve o starvation
    // sem mascarar hang (que nunca completa). Ver PR do db-audit.
  }, 30_000);
});
