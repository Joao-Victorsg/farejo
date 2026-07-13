import "dotenv/config";
import { createClient, type PlatformAdapter } from "@farejo/shared";
import { cuponomiaAdapter } from "./cuponomia.js";
import { interAdapter } from "./inter.js";
import { resolveSupabaseCredentials } from "./localDb.js";
import { meliuzAdapter } from "./meliuz.js";
import { mycashbackAdapter } from "./mycashback.js";
import { exitCodeFor, runAllPlatforms, runTieredPlatform, type PlatformRunResult } from "./runner.js";
import type { SupabaseClient } from "./supabaseClient.js";
import { zoomAdapter } from "./zoom.js";

// Sites de 1 request, sem crawl_state (ADR-0005): recebem sempre a instrução full.
export const fullScopeAdapters: PlatformAdapter[] = [interAdapter, mycashbackAdapter, zoomAdapter];

// Tamanho da fatia por tier (T11/#23). O tuning de produção (524 ativas/~55 cauda por dia
// no cuponomia, 664/~337 no méliuz — CLAUDE.md) é decisão do workflow do Actions, um ticket
// à parte; aqui o teto só precisa ser generoso o bastante para puxar tudo que `crawl_state`
// tiver pronto numa execução manual/local.
const ACTIVE_BATCH_SIZE = 1000;
const TAIL_BATCH_SIZE = 500;

/**
 * `active` e `tail` da MESMA plataforma nunca rodam ao mesmo tempo (issue #12, história 48:
 * "concurrency agrupado por PLATAFORMA, não por plataforma+escopo... pra não dobrar a taxa
 * contra o mesmo site") — cada tier já respeita `delay_base × throttleMultiplier` sozinho,
 * mas rodar os dois em paralelo dobraria a taxa efetiva de requests contra o site enquanto
 * as duas fatias se sobrepõem, na contramão do throttle adaptativo (ADR-0005). Plataformas
 * diferentes seguem concorrentes (isolamento preservado, T10/T11).
 */
async function runTieredSequential(
  supabase: SupabaseClient,
  adapter: PlatformAdapter,
): Promise<PlatformRunResult[]> {
  const active = await runTieredPlatform(supabase, adapter, "active", ACTIVE_BATCH_SIZE);
  const tail = await runTieredPlatform(supabase, adapter, "tail", TAIL_BATCH_SIZE);
  return [active, tail];
}

async function main() {
  const { url, key } = resolveSupabaseCredentials();
  const supabase = createClient(url, key);

  const [fullResults, cuponomiaResults, meliuzResults] = await Promise.all([
    runAllPlatforms(supabase, fullScopeAdapters),
    runTieredSequential(supabase, cuponomiaAdapter),
    runTieredSequential(supabase, meliuzAdapter),
  ]);
  const results = [...fullResults, ...cuponomiaResults, ...meliuzResults];

  for (const r of results) {
    const suffix = r.error ? ` — ${r.error}` : "";
    console.log(`[${r.platformId}] ${r.status} — ${r.offersWritten} ofertas, ${r.parseErrors} parse errors${suffix}`);
  }

  process.exit(exitCodeFor(results));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
