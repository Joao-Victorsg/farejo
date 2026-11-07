import {
  SANITY_THRESHOLDS,
  evaluateSanity,
  type RunScopeLabel,
  type SanityActual,
  type SanityBaseline,
  type SanityTrip,
  type SanityVerdict,
  type ScrapeResult,
} from "@farejo/shared";
import type { SupabaseClient } from "../supabaseClient.js";
import { assertScopeHasOutcomes, buildWriteOffersOptions, prepareOffers, writeOffers } from "./run.js";
import { insertScrapeRun } from "./scrapeRunsTable.js";
import type { IntraPlatformCollision } from "./store.js";

// Revisão operacional de 07/11/2026: a queda de ~123 para 14–15 ofertas
// apareceu nos dois runners. A captura de 188 lojas/15 ofertas foi conferida
// nas páginas das 15 lojas. A referência usa as três observações 1621–1633
// descritas em docs/operacao-zoom.md, sem reclassificar runs antigos.
const ZOOM_BASELINE_RESET_AT = "2026-11-07T15:00:00.000Z";
const ZOOM_VERIFIED_BASELINE: SanityBaseline = {
  n: 3,
  avgOffersFound: 188,
  avgActiveOffers: (14 + 15 + 15) / 3,
};

export interface ScrapeRunOutcome {
  runId: number;
  status: "ok" | "suspicious";
  offersWritten: number;
  parseErrors: number;
  tripped: SanityTrip | null;
  anomalies: IntraPlatformCollision[];
}

/**
 * O gate da escrita (T9, docs/farejo-system-design.md §"Sanity check"): prepara o run
 * (validação + parse + normalização, via `prepareOffers`), avalia as 4 regras contra o
 * baseline dos últimos runs `ok` da plataforma **do mesmo `scope`** (T5/#17, ADR-0004 —
 * um run `active` nunca se mistura com um run `tail` da mesma plataforma), e só escreve
 * (`writeOffers`) se o veredito for `ok`. Sempre grava uma linha em `scrape_runs`, `ok`
 * ou `suspicious`, com `notes` auto-diagnóstico — inclusive no cold-start, para semear o
 * próprio baseline. `scope` default `'full'` preserva o comportamento da Fase 1 para
 * inter/mycashback/zoom.
 */
export async function runPlatformScrape(
  supabase: SupabaseClient,
  platformId: string,
  scrapeResult: ScrapeResult,
  runStartedAt: Date,
  scope: RunScopeLabel = "full",
): Promise<ScrapeRunOutcome> {
  assertScopeHasOutcomes(scrapeResult);

  const zoomResetAt = platformId === "zoom" && scope === "full" && runStartedAt.toISOString() >= ZOOM_BASELINE_RESET_AT
    ? ZOOM_BASELINE_RESET_AT
    : undefined;
  const [historicalBaseline, prepared] = await Promise.all([
    loadBaseline(supabase, platformId, scope, zoomResetAt),
    prepareOffers(supabase, platformId, scrapeResult),
  ]);
  const useVerifiedReference = zoomResetAt !== undefined && historicalBaseline.n < SANITY_THRESHOLDS.minBaselineRuns;
  const baseline = useVerifiedReference ? ZOOM_VERIFIED_BASELINE : historicalBaseline;

  const actual: SanityActual = {
    offersFound: scrapeResult.rawCount,
    activeOffers: scrapeResult.offers.length,
    parseErrors: prepared.parseErrors,
    declaredTotal: scrapeResult.declaredTotal ?? null,
    scope,
  };
  const evaluated = evaluateSanity(actual, baseline);
  const verdict = zoomResetAt === undefined ? evaluated : enforceZoomSanity(evaluated, actual, useVerifiedReference);

  if (verdict.verdict === "ok") {
    // T11/#23: sincroniza crawl_state (tier/store_id) e restringe a desativação por
    // ausência ao escopo do run — sem isso, `pipeline_write_offers` rejeita qualquer
    // plataforma tiered (p_scope_store_ids chegaria null com linhas em crawl_state).
    const options = await buildWriteOffersOptions(supabase, platformId, scrapeResult, prepared);
    await writeOffers(supabase, platformId, runStartedAt, prepared.rows, options);
  }

  const runId = await insertScrapeRun(supabase, {
    platformId,
    startedAt: runStartedAt,
    finishedAt: new Date(),
    status: verdict.verdict,
    scope,
    offersFound: actual.offersFound,
    activeOffers: actual.activeOffers,
    parseErrors: actual.parseErrors,
    softBlocks: scrapeResult.softBlocks,
    notes: JSON.stringify({
      verdict: verdict.verdict,
      tripped: verdict.tripped,
      scope,
      // `cold_start` só reflete baseline.n < minBaselineRuns — em scope='bootstrap' as
      // regras 1/2 são puladas mesmo com cold_start:false (ADR-0004); é o `scope` acima
      // que explica o motivo real nesse caso, não este campo.
      cold_start: verdict.coldStart,
      baseline: {
        n: baseline.n,
        avg_offers: baseline.avgOffersFound,
        avg_active: baseline.avgActiveOffers,
        ...(zoomResetAt === undefined ? {} : {
          source: useVerifiedReference ? "zoom_verified_reference" : "history",
          since: zoomResetAt,
          accepted_runs: historicalBaseline.n,
        }),
      },
      actual: {
        offers_found: actual.offersFound,
        active_offers: actual.activeOffers,
        raw_count: actual.offersFound,
        declared_total: actual.declaredTotal,
        parse_errors: actual.parseErrors,
        soft_blocks: scrapeResult.softBlocks,
      },
      parse_error_samples: prepared.parseErrorSamples,
    }),
  });

  return {
    runId,
    status: verdict.verdict,
    offersWritten: verdict.verdict === "ok" ? prepared.rows.length : 0,
    parseErrors: prepared.parseErrors,
    tripped: verdict.tripped,
    anomalies: prepared.anomalies,
  };
}

function enforceZoomSanity(
  verdict: SanityVerdict,
  actual: SanityActual,
  useVerifiedReference: boolean,
): SanityVerdict {
  if (verdict.verdict !== "ok") return verdict;
  if (actual.declaredTotal === null) {
    return { ...verdict, verdict: "suspicious", tripped: "rule4_declared_vs_raw" };
  }
  // Durante a transição, a tolerância de 10% sobre todas as lojas poderia
  // ocultar a perda de boa parte das poucas ofertas ativas.
  if (useVerifiedReference && actual.parseErrors > 0) {
    return { ...verdict, verdict: "suspicious", tripped: "rule3_parse_errors" };
  }
  return verdict;
}

async function loadBaseline(
  supabase: SupabaseClient,
  platformId: string,
  scope: RunScopeLabel,
  since?: string,
): Promise<SanityBaseline> {
  const query = supabase
    .from("scrape_runs")
    .select("offers_found, active_offers")
    .eq("platform_id", platformId)
    .eq("scope", scope)
    .eq("status", "ok");
  if (since !== undefined) query.gte("started_at", since);
  const { data, error } = await query
    .order("started_at", { ascending: false })
    .limit(SANITY_THRESHOLDS.baselineWindow);
  if (error) throw error;

  const rows = data ?? [];
  return {
    n: rows.length,
    avgOffersFound: mean(rows.map((r) => r.offers_found)),
    avgActiveOffers: mean(rows.map((r) => r.active_offers)),
  };
}

function mean(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}
