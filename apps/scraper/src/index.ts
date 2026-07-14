import "dotenv/config";
import { createClient, type PlatformAdapter } from "@farejo/shared";
import { z } from "zod";
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

const ScrapeTier = z.enum(["active", "tail"]).default("active");
const ScrapePlatform = z.enum(["all", "inter", "mycashback", "zoom", "cuponomia", "meliuz"]).default("all");

type ScrapeTier = z.infer<typeof ScrapeTier>;
type ScrapePlatform = z.infer<typeof ScrapePlatform>;

// O ativo inteiro cabe no teto atual; a cauda é deliberadamente fatiada para cumprir a
// cadência de 1×/5 dias: ~55 do Cuponomia e ~337 do Méliuz por dia. Os valores são por
// plataforma porque as caudas têm tamanhos muito diferentes.
const tieredAdapters = [
  { adapter: cuponomiaAdapter, batchSizes: { active: 1000, tail: 55 } },
  { adapter: meliuzAdapter, batchSizes: { active: 1000, tail: 337 } },
] as const;

/**
 * Cada invocação seleciona um único tier. Isso preserva a cadência da cauda e garante que
 * uma loja demovida de `active` não seja raspada outra vez como `tail` no mesmo ciclo. O
 * Actions deve executar o default `active` a cada 12h e `SCRAPE_TIER=tail` uma vez por dia;
 * plataformas diferentes continuam concorrentes (isolamento preservado, T10/T11).
 */
async function runTieredForScope(
  supabase: SupabaseClient,
  tier: ScrapeTier,
): Promise<PlatformRunResult[]> {
  return Promise.all(
    tieredAdapters.map(({ adapter, batchSizes }) => runTieredPlatform(supabase, adapter, tier, batchSizes[tier])),
  );
}

/**
 * Executa somente a plataforma solicitada pelo job do Actions. O default `all` preserva
 * a execução local original, mas o cron sempre fornece `SCRAPE_PLATFORM` para que cada
 * job escreva uma única linha de `scrape_runs` com seu escopo homogêneo (ADR-0004).
 */
async function runSelectedPlatform(
  supabase: SupabaseClient,
  platform: ScrapePlatform,
  tier: ScrapeTier,
): Promise<PlatformRunResult[]> {
  switch (platform) {
    case "all": {
      const [fullResults, tieredResults] = await Promise.all([
        runAllPlatforms(supabase, fullScopeAdapters),
        runTieredForScope(supabase, tier),
      ]);
      return [...fullResults, ...tieredResults];
    }
    case "inter":
      return runAllPlatforms(supabase, [interAdapter]);
    case "mycashback":
      return runAllPlatforms(supabase, [mycashbackAdapter]);
    case "zoom":
      return runAllPlatforms(supabase, [zoomAdapter]);
    case "cuponomia":
      return [await runTieredPlatform(supabase, cuponomiaAdapter, tier, tieredAdapters[0].batchSizes[tier])];
    case "meliuz":
      return [await runTieredPlatform(supabase, meliuzAdapter, tier, tieredAdapters[1].batchSizes[tier])];
  }
}

async function main() {
  const { url, key } = resolveSupabaseCredentials();
  const supabase = createClient(url, key);
  const tier = ScrapeTier.parse(process.env.SCRAPE_TIER);
  const platform = ScrapePlatform.parse(process.env.SCRAPE_PLATFORM);
  const results = await runSelectedPlatform(supabase, platform, tier);

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
