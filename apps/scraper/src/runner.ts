import {
  CircuitBreakerError,
  nextThrottleMultiplier,
  type PlatformAdapter,
  type RunScopeLabel,
  type ScrapeInstruction,
  type ThrottleRunOutcome,
} from "@farejo/shared";
import { type CrawlTier, loadCrawlStateSlugs, loadUnvisitedCrawlStateSlugs } from "./pipeline/crawlStateSlugs.js";
import { loadThrottleMultiplier, updateThrottleMultiplier } from "./pipeline/platformThrottle.js";
import { runPlatformScrape } from "./pipeline/scrapeRun.js";
import { insertScrapeRun } from "./pipeline/scrapeRunsTable.js";
import type { CatalogInvalidator } from "./catalogInvalidation.js";
import type { SupabaseClient } from "./supabaseClient.js";

export interface PlatformRunResult {
  platformId: string;
  status: "ok" | "suspicious" | "failed" | "invalidation_failed";
  offersWritten: number;
  parseErrors: number;
  error: string | null;
}

/**
 * T10, o capstone: orquestra todas as plataformas. Cada uma roda isolada — `adapter.scrape(instruction)`
 * já esgotou os retries de rede (http.ts) antes de chegar aqui, então qualquer erro nesse ponto
 * é definitivo: grava `failed` em `scrape_runs` (nunca escreve em `offers`) e não derruba as
 * outras plataformas. Roda em paralelo: plataformas não compartilham estado no pipeline.
 * Depois de todo run com desfecho (sucesso ou `CircuitBreakerError`), também sincroniza
 * `platforms.throttle_multiplier` (T6/#18, ADR-0005 decisão 3).
 */
export async function runAllPlatforms(
  supabase: SupabaseClient,
  adapters: PlatformAdapter[],
  invalidateCatalog: CatalogInvalidator = async () => {},
): Promise<PlatformRunResult[]> {
  return Promise.all(adapters.map((adapter) => runOnePlatform(supabase, adapter, invalidateCatalog)));
}

/** Exit code do processo (T10): 0 só se toda plataforma terminou `ok`. */
export function exitCodeFor(results: PlatformRunResult[]): number {
  return results.every((r) => r.status === "ok") ? 0 : 1;
}

// Sites de 1 request (inter, mycashback, zoom): sempre a instrução full, sem crawl_state
// (ADR-0005 — "sites de 1 request recebem target:{kind:'full'} e ignoram throttleMultiplier").
const FULL_SCRAPE_INSTRUCTION: ScrapeInstruction = { throttleMultiplier: 1, target: { kind: "full" } };

function runOnePlatform(supabase: SupabaseClient, adapter: PlatformAdapter, invalidateCatalog: CatalogInvalidator): Promise<PlatformRunResult> {
  return runPlatform(supabase, adapter, "full", () => FULL_SCRAPE_INSTRUCTION, invalidateCatalog);
}

/**
 * T11/#23, o capstone da Fase 2: coleta tiered para cuponomia/méliuz. Diferente de
 * `runOnePlatform` (instrução `full` fixa), aqui o runner MONTA a instrução — lê a fatia
 * mais vencida de `crawl_state` para o `tier` pedido e `platforms.throttle_multiplier`
 * atual — antes de chamar `adapter.scrape` (ADR-0005 decisão 4). Mesmo isolamento e mesma
 * sincronização de throttle de `runOnePlatform` (via `runPlatform`, compartilhado); a
 * única diferença é como a instrução nasce e que `tier` (não `'full'`) é o que vai para
 * `scrape_runs.scope`.
 */
export function runTieredPlatform(
  supabase: SupabaseClient,
  adapter: PlatformAdapter,
  tier: CrawlTier,
  limit: number,
  invalidateCatalog: CatalogInvalidator = async () => {},
): Promise<PlatformRunResult> {
  return runPlatform(supabase, adapter, tier, async () => {
    const [throttleMultiplier, slugs] = await Promise.all([
      loadThrottleMultiplier(supabase, adapter.platformId),
      loadCrawlStateSlugs(supabase, adapter.platformId, tier, limit),
    ]);
    return { throttleMultiplier, target: { kind: "slugs", slugs } };
  }, invalidateCatalog);
}

/**
 * Bootstrap manual (T12/#24): pega somente slugs sem `last_checked_at`, independente
 * do tier, e os envia ao mesmo pipeline parcial dos runs regulares. Cada execução é um
 * lote retomável; quem já teve desfecho real não volta a entrar na instrução seguinte.
 */
export async function runBootstrapPlatform(
  supabase: SupabaseClient,
  adapter: PlatformAdapter,
  limit: number,
  invalidateCatalog: CatalogInvalidator = async () => {},
): Promise<PlatformRunResult> {
  const [slugs, throttleMultiplier] = await Promise.all([
    loadUnvisitedCrawlStateSlugs(supabase, adapter.platformId, limit),
    loadThrottleMultiplier(supabase, adapter.platformId),
  ]);
  if (slugs.length === 0) {
    return { platformId: adapter.platformId, status: "ok", offersWritten: 0, parseErrors: 0, error: null };
  }

  return runPlatform(supabase, adapter, "bootstrap", () => ({
    throttleMultiplier,
    target: { kind: "slugs", slugs },
  }), invalidateCatalog);
}

/**
 * Corpo comum de `runOnePlatform`/`runTieredPlatform` (T11/#23 — extraído para não
 * duplicar o try/catch de isolamento + sincronização de throttle entre os dois): monta a
 * instrução (síncrona pra `full`, assíncrona — lê crawl_state/throttle — pra tiered),
 * chama o adapter, roda o gate de sanity, e sincroniza `platforms.throttle_multiplier` no
 * fim, sucesso ou `CircuitBreakerError`. `scope` é o mesmo valor em toda a função: o que
 * vai pro gate de sanity (`runPlatformScrape`) É o que vai pra `scrape_runs.scope` em
 * qualquer desfecho (ok, suspicious, aborted ou failed).
 */
async function runPlatform(
  supabase: SupabaseClient,
  adapter: PlatformAdapter,
  scope: RunScopeLabel,
  buildInstruction: () => ScrapeInstruction | Promise<ScrapeInstruction>,
  invalidateCatalog: CatalogInvalidator,
): Promise<PlatformRunResult> {
  const runStartedAt = new Date();
  try {
    const instruction = await buildInstruction();
    const scrapeResult = await adapter.scrape(instruction);
    const outcome = await runPlatformScrape(supabase, adapter.platformId, scrapeResult, runStartedAt, scope);
    await syncThrottleMultiplier(supabase, adapter.platformId, {
      aborted: false,
      ratio: softBlockRatio(scrapeResult.softBlocks, scrapeResult.rawCount),
    });
    if (outcome.status === "ok") {
      try {
        await invalidateCatalog({ platformId: adapter.platformId, runId: outcome.runId, timestamp: new Date() });
      } catch {
        console.error(`[catalog-invalidation] failed after committed run ${outcome.runId} for ${adapter.platformId}; retry the job`);
        return {
          platformId: adapter.platformId,
          status: "invalidation_failed",
          offersWritten: outcome.offersWritten,
          parseErrors: outcome.parseErrors,
          error: "Catalog invalidation failed after the scrape was committed",
        };
      }
    }
    return {
      platformId: adapter.platformId,
      status: outcome.status,
      offersWritten: outcome.offersWritten,
      parseErrors: outcome.parseErrors,
      error: null,
    };
  } catch (err) {
    // ADR-0005 decisão 1: CircuitBreakerError carrega o estado parcial até o abort —
    // grava softBlocks/rawCount reais (nunca 0) e ainda assim sincroniza o throttle,
    // já que um abort é o sinal mais forte de "sobe de nível" que existe.
    if (err instanceof CircuitBreakerError) {
      await recordAbortedRun(supabase, adapter.platformId, runStartedAt, err, scope);
      await syncThrottleMultiplier(supabase, adapter.platformId, {
        aborted: true,
        ratio: softBlockRatio(err.softBlocksSoFar, err.rawCountSoFar),
      });
      return { platformId: adapter.platformId, status: "failed", offersWritten: 0, parseErrors: 0, error: err.message };
    }

    // Erro genérico (rede exaurida, DB fora do ar, crawl_state/throttle_multiplier
    // ilegível, etc.): sem soft-blocks reais pra reportar, o throttle não é tocado — não
    // é sinal de comportamento do site.
    const message = err instanceof Error ? err.message : String(err);
    await recordFailedRun(supabase, adapter.platformId, runStartedAt, message, scope);
    return { platformId: adapter.platformId, status: "failed", offersWritten: 0, parseErrors: 0, error: message };
  }
}

function softBlockRatio(softBlocks: number, rawCount: number): number {
  return rawCount > 0 ? softBlocks / rawCount : 0;
}

/**
 * Avaliado 1x por run com desfecho (sucesso ou CircuitBreakerError), inter-run (ADR-0005
 * decisão 3). Nunca lança: uma falha aqui é uma anomalia de política de throttle, não o
 * desfecho do run — deixar propagar cairia no catch genérico de `runOnePlatform` e
 * reclassificaria (e duplicaria em `scrape_runs`) um run que já escreveu como "failed".
 */
async function syncThrottleMultiplier(
  supabase: SupabaseClient,
  platformId: string,
  outcome: ThrottleRunOutcome,
): Promise<void> {
  try {
    const current = await loadThrottleMultiplier(supabase, platformId);
    const next = nextThrottleMultiplier(current, outcome);
    if (next !== current) {
      await updateThrottleMultiplier(supabase, platformId, next);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[throttle] falha ao sincronizar throttle_multiplier de "${platformId}": ${message}`);
  }
}

async function recordFailedRun(
  supabase: SupabaseClient,
  platformId: string,
  runStartedAt: Date,
  message: string,
  scope: RunScopeLabel = "full",
): Promise<void> {
  await insertScrapeRun(supabase, {
    platformId,
    startedAt: runStartedAt,
    finishedAt: new Date(),
    status: "failed",
    scope,
    offersFound: null,
    activeOffers: null,
    parseErrors: null,
    softBlocks: 0,
    notes: JSON.stringify({ verdict: "failed", error: message }),
  });
}

/** Aborto pelo circuit breaker (ADR-0005 decisão 1): grava softBlocks/rawCount reais, nunca 0. */
async function recordAbortedRun(
  supabase: SupabaseClient,
  platformId: string,
  runStartedAt: Date,
  err: CircuitBreakerError,
  scope: RunScopeLabel = "full",
): Promise<void> {
  await insertScrapeRun(supabase, {
    platformId,
    startedAt: runStartedAt,
    finishedAt: new Date(),
    status: "failed",
    scope,
    offersFound: err.rawCountSoFar,
    activeOffers: null,
    parseErrors: null,
    softBlocks: err.softBlocksSoFar,
    notes: JSON.stringify({
      verdict: "failed",
      error: err.message,
      aborted_by: "circuit_breaker",
      soft_blocks: err.softBlocksSoFar,
      raw_count: err.rawCountSoFar,
    }),
  });
}
