import { CircuitBreakerError, nextThrottleMultiplier, type PlatformAdapter, type ScrapeInstruction, type ThrottleRunOutcome } from "@farejo/shared";
import { loadThrottleMultiplier, updateThrottleMultiplier } from "./pipeline/platformThrottle.js";
import { runPlatformScrape } from "./pipeline/scrapeRun.js";
import { insertScrapeRun } from "./pipeline/scrapeRunsTable.js";
import type { SupabaseClient } from "./supabaseClient.js";

export interface PlatformRunResult {
  platformId: string;
  status: "ok" | "suspicious" | "failed";
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
): Promise<PlatformRunResult[]> {
  return Promise.all(adapters.map((adapter) => runOnePlatform(supabase, adapter)));
}

/** Exit code do processo (T10): 0 só se toda plataforma terminou `ok`. */
export function exitCodeFor(results: PlatformRunResult[]): number {
  return results.every((r) => r.status === "ok") ? 0 : 1;
}

// Coleta tiered (lendo crawl_state/throttle_multiplier) ainda não existe (Fase 2, tickets
// futuros) — por ora todo adapter recebe a mesma instrução full, sem throttle.
const FULL_SCRAPE_INSTRUCTION: ScrapeInstruction = { throttleMultiplier: 1, target: { kind: "full" } };

async function runOnePlatform(supabase: SupabaseClient, adapter: PlatformAdapter): Promise<PlatformRunResult> {
  const runStartedAt = new Date();
  try {
    const scrapeResult = await adapter.scrape(FULL_SCRAPE_INSTRUCTION);
    const outcome = await runPlatformScrape(supabase, adapter.platformId, scrapeResult, runStartedAt);
    await syncThrottleMultiplier(supabase, adapter.platformId, {
      aborted: false,
      ratio: softBlockRatio(scrapeResult.softBlocks, scrapeResult.rawCount),
    });
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
      await recordAbortedRun(supabase, adapter.platformId, runStartedAt, err);
      await syncThrottleMultiplier(supabase, adapter.platformId, {
        aborted: true,
        ratio: softBlockRatio(err.softBlocksSoFar, err.rawCountSoFar),
      });
      return { platformId: adapter.platformId, status: "failed", offersWritten: 0, parseErrors: 0, error: err.message };
    }

    // Erro genérico (rede exaurida, DB fora do ar, etc.): sem soft-blocks reais pra
    // reportar, o throttle não é tocado — não é sinal de comportamento do site.
    const message = err instanceof Error ? err.message : String(err);
    await recordFailedRun(supabase, adapter.platformId, runStartedAt, message);
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
): Promise<void> {
  await insertScrapeRun(supabase, {
    platformId,
    startedAt: runStartedAt,
    finishedAt: new Date(),
    status: "failed",
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
): Promise<void> {
  await insertScrapeRun(supabase, {
    platformId,
    startedAt: runStartedAt,
    finishedAt: new Date(),
    status: "failed",
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
