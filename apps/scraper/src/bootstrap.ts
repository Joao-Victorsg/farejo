import "dotenv/config";
import { createClient, type PlatformAdapter } from "@farejo/shared";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { cuponomiaAdapter } from "./cuponomia.js";
import { resolveSupabaseCredentials } from "./localDb.js";
import { meliuzAdapter } from "./meliuz.js";
import { exitCodeFor, runBootstrapPlatform } from "./runner.js";
import { TIERED_PLATFORM_IDS, type TieredPlatformId } from "./seed.js";

const BootstrapEnvironment = z.object({
  BOOTSTRAP_PLATFORM: z.enum(TIERED_PLATFORM_IDS),
  BOOTSTRAP_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(500),
});

const TIERED_ADAPTERS: Record<TieredPlatformId, PlatformAdapter> = {
  cuponomia: cuponomiaAdapter,
  meliuz: meliuzAdapter,
};

async function main(): Promise<void> {
  const { BOOTSTRAP_PLATFORM: platformId, BOOTSTRAP_BATCH_SIZE: batchSize } = BootstrapEnvironment.parse(process.env);
  const { url, key } = resolveSupabaseCredentials();
  const result = await runBootstrapPlatform(createClient(url, key), TIERED_ADAPTERS[platformId], batchSize);
  const suffix = result.error ? ` — ${result.error}` : "";

  console.log(
    `[${result.platformId}] bootstrap ${result.status} — ${result.offersWritten} ofertas, ${result.parseErrors} parse errors${suffix}`,
  );
  process.exitCode = exitCodeFor([result]);
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
