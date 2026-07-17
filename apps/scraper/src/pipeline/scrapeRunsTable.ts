import type { RunScopeLabel } from "@farejo/shared";
import { z } from "zod";
import type { SupabaseClient } from "../supabaseClient.js";

export interface ScrapeRunRow {
  platformId: string;
  startedAt: Date;
  finishedAt: Date;
  status: string;
  offersFound: number | null;
  activeOffers: number | null;
  parseErrors: number | null;
  softBlocks: number;
  notes: string;
  /** Omitido preserva o default `'full'` da coluna (Fase 1: inter/mycashback/zoom, ADR-0004). */
  scope?: RunScopeLabel;
}

/** Única forma de gravar em `scrape_runs` — usada pelo gate de sanity (T9, `pipeline/scrapeRun.ts`) e pelo caminho `failed` do runner (T10). */
export async function insertScrapeRun(supabase: SupabaseClient, row: ScrapeRunRow): Promise<number> {
  const { data, error } = await supabase.from("scrape_runs").insert({
    platform_id: row.platformId,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt.toISOString(),
    status: row.status,
    offers_found: row.offersFound,
    active_offers: row.activeOffers,
    parse_errors: row.parseErrors,
    soft_blocks: row.softBlocks,
    notes: row.notes,
    scope: row.scope ?? "full",
  }).select("id").single();
  if (error) throw error;
  return z.object({ id: z.number().int().positive() }).parse(data).id;
}
