import {
  SANITY_THRESHOLDS,
  evaluateSanity,
  type SanityActual,
  type SanityBaseline,
  type SanityTrip,
  type ScrapeResult,
} from "@farejo/shared";
import type { SupabaseClient } from "../supabaseClient.js";
import { prepareOffers, writeOffers } from "./run.js";
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
 * baseline dos últimos runs `ok` da plataforma, e só escreve (`writeOffers`) se o
 * veredito for `ok`. Sempre grava uma linha em `scrape_runs`, `ok` ou `suspicious`, com
 * `notes` auto-diagnóstico — inclusive no cold-start, para semear o próprio baseline.
 */
export async function runPlatformScrape(
  supabase: SupabaseClient,
  platformId: string,
  scrapeResult: ScrapeResult,
  runStartedAt: Date,
): Promise<ScrapeRunOutcome> {
  const [baseline, prepared] = await Promise.all([
    loadBaseline(supabase, platformId),
    prepareOffers(supabase, platformId, scrapeResult),
  ]);

  const actual: SanityActual = {
    offersFound: scrapeResult.rawCount,
    activeOffers: scrapeResult.offers.length,
    parseErrors: prepared.parseErrors,
    declaredTotal: scrapeResult.declaredTotal ?? null,
  };
  const verdict = evaluateSanity(actual, baseline);

  if (verdict.verdict === "ok") {
    await writeOffers(supabase, platformId, runStartedAt, prepared.rows);
  }

  const { error } = await supabase.from("scrape_runs").insert({
    platform_id: platformId,
    started_at: runStartedAt.toISOString(),
    finished_at: new Date().toISOString(),
    status: verdict.verdict,
    offers_found: actual.offersFound,
    active_offers: actual.activeOffers,
    parse_errors: actual.parseErrors,
    soft_blocks: scrapeResult.softBlocks,
    notes: JSON.stringify({
      verdict: verdict.verdict,
      tripped: verdict.tripped,
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
  if (error) throw error;

  return {
    status: verdict.verdict,
    offersWritten: verdict.verdict === "ok" ? prepared.rows.length : 0,
    parseErrors: prepared.parseErrors,
    tripped: verdict.tripped,
    anomalies: prepared.anomalies,
  };
}

async function loadBaseline(supabase: SupabaseClient, platformId: string): Promise<SanityBaseline> {
  const { data, error } = await supabase
    .from("scrape_runs")
    .select("offers_found, active_offers")
    .eq("platform_id", platformId)
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
