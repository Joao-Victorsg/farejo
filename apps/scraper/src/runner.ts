import type { PlatformAdapter, ScrapeInstruction } from "@farejo/shared";
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
    return {
      platformId: adapter.platformId,
      status: outcome.status,
      offersWritten: outcome.offersWritten,
      parseErrors: outcome.parseErrors,
      error: null,
    };
  } catch (err) {
    // TODO(ADR-0005 decisão 1): distinguir `CircuitBreakerError` aqui e gravar
    // softBlocksSoFar/rawCountSoFar reais em vez de zerar — chega com os crawlers
    // tiered (méliuz/cuponomia), que são os únicos que lançam essa classe.
    const message = err instanceof Error ? err.message : String(err);
    await recordFailedRun(supabase, adapter.platformId, runStartedAt, message);
    return { platformId: adapter.platformId, status: "failed", offersWritten: 0, parseErrors: 0, error: message };
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
