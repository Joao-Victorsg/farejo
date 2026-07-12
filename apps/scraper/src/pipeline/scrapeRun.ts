import {
  SANITY_THRESHOLDS,
  evaluateSanity,
  type RunScopeLabel,
  type SanityActual,
  type SanityBaseline,
  type SanityTrip,
  type ScrapeResult,
} from "@farejo/shared";
import type { SupabaseClient } from "../supabaseClient.js";
import { prepareOffers, writeOffers } from "./run.js";
import { insertScrapeRun } from "./scrapeRunsTable.js";
import type { IntraPlatformCollision } from "./store.js";

export interface ScrapeRunOutcome {
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
  const [baseline, prepared] = await Promise.all([
    loadBaseline(supabase, platformId, scope),
    prepareOffers(supabase, platformId, scrapeResult),
  ]);

  const actual: SanityActual = {
    offersFound: scrapeResult.rawCount,
    activeOffers: scrapeResult.offers.length,
    parseErrors: prepared.parseErrors,
    declaredTotal: scrapeResult.declaredTotal ?? null,
    scope,
  };
  const verdict = evaluateSanity(actual, baseline);

  if (verdict.verdict === "ok") {
    await writeOffers(supabase, platformId, runStartedAt, prepared.rows);
  }

  await insertScrapeRun(supabase, {
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
      baseline: { n: baseline.n, avg_offers: baseline.avgOffersFound, avg_active: baseline.avgActiveOffers },
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
    status: verdict.verdict,
    offersWritten: verdict.verdict === "ok" ? prepared.rows.length : 0,
    parseErrors: prepared.parseErrors,
    tripped: verdict.tripped,
    anomalies: prepared.anomalies,
  };
}

async function loadBaseline(supabase: SupabaseClient, platformId: string, scope: RunScopeLabel): Promise<SanityBaseline> {
  const { data, error } = await supabase
    .from("scrape_runs")
    .select("offers_found, active_offers")
    .eq("platform_id", platformId)
    .eq("scope", scope)
    .eq("status", "ok")
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
