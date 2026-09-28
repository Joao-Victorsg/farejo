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

const ScrapeRunner = z.enum(["cloud-run"]).optional();

/** Acrescenta a origem operacional sem alterar o contrato relacional de `scrape_runs`. */
export function withExecutionSource(notes: string, runner: unknown): string {
  const source = ScrapeRunner.parse(runner);
  if (!source) return notes;

  const parsed: unknown = JSON.parse(notes);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("scrape_runs.notes precisa ser um objeto JSON para receber execution_source");
  }

  return JSON.stringify({ ...parsed, execution_source: source });
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
    notes: withExecutionSource(row.notes, process.env.SCRAPE_RUNNER),
    scope: row.scope ?? "full",
  }).select("id").single();
  if (error) throw error;
  return z.object({ id: z.number().int().positive() }).parse(data).id;
}
