import type { RunScopeLabel } from "@farejo/shared";
import type { SupabaseClient } from "../supabaseClient.js";

/** Só os dois tiers que `crawl_state.tier` aceita (T3/#15 CHECK) — nunca `full`/`bootstrap`. */
export type CrawlTier = Extract<RunScopeLabel, "active" | "tail">;

/**
 * A fatia diária do agendador (ADR-0005 decisão 4): os `limit` slugs mais vencidos de um
 * tier, via o índice `idx_crawl_state_scheduler` (T3/#15). `nullsFirst` é essencial — o
 * Postgres por padrão põe NULL por último em ASC, o que inverteria a prioridade e faria
 * um slug nunca visitado esperar atrás de todo mundo já checado.
 */
export async function loadCrawlStateSlugs(
  supabase: SupabaseClient,
  platformId: string,
  tier: CrawlTier,
  limit: number,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("crawl_state")
    .select("slug")
    .eq("platform_id", platformId)
    .eq("tier", tier)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => row.slug);
}
