import "dotenv/config";
import { createClient, type PlatformAdapter } from "@farejo/shared";
import { interAdapter } from "./inter.js";
import { resolveSupabaseCredentials } from "./localDb.js";
import { mycashbackAdapter } from "./mycashback.js";
import { exitCodeFor, runAllPlatforms } from "./runner.js";

export const adapters: PlatformAdapter[] = [interAdapter, mycashbackAdapter];

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
