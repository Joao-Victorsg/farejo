import "dotenv/config";
import { createClient, type PlatformAdapter } from "@farejo/shared";
import { interAdapter } from "./inter.js";
import { resolveSupabaseCredentials } from "./localDb.js";
import { mycashbackAdapter } from "./mycashback.js";
import { exitCodeFor, runAllPlatforms } from "./runner.js";
import { zoomAdapter } from "./zoom.js";

// cuponomiaAdapter (T8/#20) é coleta tiered por slugs — ainda não plugado aqui: o runner só
// monta ScrapeInstruction de escopo `full` (T11/#23 liga a coleta tiered lendo crawl_state).
export const adapters: PlatformAdapter[] = [interAdapter, mycashbackAdapter, zoomAdapter];

async function main() {
  const { url, key } = resolveSupabaseCredentials();
  const supabase = createClient(url, key);

  const results = await runAllPlatforms(supabase, adapters);
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
