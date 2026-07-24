import { CircuitBreakerError, type PlatformAdapter, type RawOffer, type ScrapeResult } from "@farejo/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runAllPlatforms } from "./runner.js";
import { localSupabaseClient } from "./testDb.js";

/**
 * T6/#18 — o runner distingue `CircuitBreakerError` de qualquer outro erro e sincroniza
 * `platforms.throttle_multiplier` (ADR-0005) depois de todo run com desfecho (sucesso ou
 * abort). Adapters fake só — não depende de nenhum crawler tiered real (méliuz/cuponomia).
 */
const client = localSupabaseClient();

const PLATFORM_ABORT = "test-t18-abort";
const PLATFORM_RISE = "test-t18-rise";
const PLATFORM_FALL = "test-t18-fall";
const PLATFORM_HYSTERESIS = "test-t18-hysteresis";
const PLATFORM_CEILING = "test-t18-ceiling";
const PLATFORM_FLOOR = "test-t18-floor";
const ALL_PLATFORMS = [
  PLATFORM_ABORT,
  PLATFORM_RISE,
  PLATFORM_FALL,
  PLATFORM_HYSTERESIS,
  PLATFORM_CEILING,
  PLATFORM_FLOOR,
];

function offersOf(n: number, label: string): RawOffer[] {
  return Array.from({ length: n }, (_, i) => ({
    storeName: `${label} T18 ${i}`,
    rewardText: "5% cashback",
    url: `https://example.test/${label}-${i}`,
  }));
}

/** Adapter fake: sucesso normal, com rawCount/softBlocks controlados pelo teste. */
function successAdapter(platformId: string, rawCount: number, softBlocks: number): PlatformAdapter {
  return {
    platformId,
    async scrape(): Promise<ScrapeResult> {
      return { offers: offersOf(rawCount, platformId), scope: { kind: "full" }, rawCount, softBlocks };
    },
  };
}

/** Adapter fake: simula o circuit breaker abortando o crawl (12 soft-blocks seguidos). */
function abortingAdapter(platformId: string, softBlocksSoFar: number, rawCountSoFar: number): PlatformAdapter {
  return {
    platformId,
    async scrape(): Promise<ScrapeResult> {
      throw new CircuitBreakerError("circuit breaker: 12 soft-blocks seguidos", { softBlocksSoFar, rawCountSoFar });
    },
  };
}

async function throttleMultiplierOf(platformId: string): Promise<number> {
  const { data, error } = await client.from("platforms").select("throttle_multiplier").eq("id", platformId).single();
  if (error) throw error;
  return data.throttle_multiplier;
}

async function seedPlatform(platformId: string, throttleMultiplier: number): Promise<void> {
  const { error } = await client
    .from("platforms")
    .upsert({ id: platformId, name: platformId, base_url: `https://${platformId}.test`, throttle_multiplier: throttleMultiplier });
  if (error) throw error;
}

describe("runner — throttle adaptativo (T6/#18, Postgres local)", () => {
  beforeEach(async () => {
    await seedPlatform(PLATFORM_ABORT, 1);
    await seedPlatform(PLATFORM_RISE, 1);
    await seedPlatform(PLATFORM_FALL, 4);
    await seedPlatform(PLATFORM_HYSTERESIS, 2);
    await seedPlatform(PLATFORM_CEILING, 4);
    await seedPlatform(PLATFORM_FLOOR, 1);
  });

  afterAll(async () => {
    await client.from("scrape_runs").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("platforms").delete().in("id", ALL_PLATFORMS);
  });

  it("catch de CircuitBreakerError grava soft_blocks e um rawCount reais (nunca 0) e sobe o multiplier", async () => {
    const [result] = await runAllPlatforms(client, [abortingAdapter(PLATFORM_ABORT, 47, 300)]);
    expect(result).toMatchObject({ platformId: PLATFORM_ABORT, status: "failed" });

    const { data: run } = await client
      .from("scrape_runs")
      .select("*")
      .eq("platform_id", PLATFORM_ABORT)
      .single();
    expect(run).toMatchObject({ status: "failed", soft_blocks: 47, offers_found: 300 });

    // Multiplier começou em 1; abort sobe pra 2.
    expect(await throttleMultiplierOf(PLATFORM_ABORT)).toBe(2);
  });

  it("respeita o teto 4: abort com multiplier já em 4 permanece em 4", async () => {
    await runAllPlatforms(client, [abortingAdapter(PLATFORM_CEILING, 20, 100)]);
    expect(await throttleMultiplierOf(PLATFORM_CEILING)).toBe(4);
  });

  it("um run limpo com softBlocks/rawCount > 5% (sem abortar) sobe o multiplier", async () => {
    // 6/100 = 6% > 5%.
    const results = await runAllPlatforms(client, [successAdapter(PLATFORM_RISE, 100, 6)]);
    expect(results).toMatchObject([{ status: "ok" }]);
    expect(await throttleMultiplierOf(PLATFORM_RISE)).toBe(2);
  });

  it("um run limpo com ratio < 2% desce o multiplier", async () => {
    // 1/100 = 1% < 2%. Multiplier começou em 4.
    await runAllPlatforms(client, [successAdapter(PLATFORM_FALL, 100, 1)]);
    expect(await throttleMultiplierOf(PLATFORM_FALL)).toBe(2);
  });

  it("respeita o piso 1: run limpo com multiplier já em 1 permanece em 1", async () => {
    await runAllPlatforms(client, [successAdapter(PLATFORM_FLOOR, 100, 0)]);
    expect(await throttleMultiplierOf(PLATFORM_FLOOR)).toBe(1);
  });

  it("entre 2% e 5% (histerese) o multiplier não muda", async () => {
    // 3/100 = 3%, dentro da faixa de histerese. Multiplier começou em 2.
    await runAllPlatforms(client, [successAdapter(PLATFORM_HYSTERESIS, 100, 3)]);
    expect(await throttleMultiplierOf(PLATFORM_HYSTERESIS)).toBe(2);
  });
  // 30s para os 6 casos (não só o :104 que estourou no deploy): cada um roda runAllPlatforms
  // com I/O de Postgres e, no CI de 2 cores, fica perto do default de 5s — no master verde vários
  // rodaram a ~4.8s. O timeout no describe herda para todos os filhos. Correção cirúrgica (não um
  // testTimeout global do pacote): os demais testes de integração do scraper seguem no default —
  // ver a nota de flakiness registrada no PR do db-audit.
}, { timeout: 30_000 });
