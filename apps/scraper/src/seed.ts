import "dotenv/config";
import { createClient } from "@farejo/shared";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { parseCuponomiaDirectory } from "./cuponomia.js";
import { fetchText } from "./http.js";
import { resolveSupabaseCredentials } from "./localDb.js";
import { parseMeliuzDirectory } from "./meliuz.js";
import type { SupabaseClient } from "./supabaseClient.js";

export const TIERED_PLATFORM_IDS = ["cuponomia", "meliuz"] as const;
export type TieredPlatformId = (typeof TIERED_PLATFORM_IDS)[number];

const DIRECTORY_SOURCES: Record<TieredPlatformId, { url: string; parse: (html: string) => string[] }> = {
  cuponomia: { url: "https://www.cuponomia.com.br/desconto", parse: parseCuponomiaDirectory },
  meliuz: { url: "https://www.meliuz.com.br/desconto", parse: parseMeliuzDirectory },
};

const DIRECTORY_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
const UPSERT_BATCH_SIZE = 500;
const SeedPlatform = z.enum(TIERED_PLATFORM_IDS).optional();

/**
 * Semeia apenas slugs ainda ausentes. `ignoreDuplicates` é essencial: uma segunda
 * execução não pode rebaixar tier nem apagar o desfecho/horário já gravado no bootstrap.
 */
export async function seedCrawlStateSlugs(
  supabase: SupabaseClient,
  platformId: TieredPlatformId | string,
  slugs: string[],
): Promise<number> {
  const uniqueSlugs = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
  if (uniqueSlugs.length === 0) throw new Error(`${platformId}: diretório não retornou nenhum slug; seed abortado`);

  for (let start = 0; start < uniqueSlugs.length; start += UPSERT_BATCH_SIZE) {
    const rows = uniqueSlugs.slice(start, start + UPSERT_BATCH_SIZE).map((slug) => ({
      platform_id: platformId,
      slug,
    }));
    const { error } = await supabase.from("crawl_state").upsert(rows, {
      onConflict: "platform_id,slug",
      ignoreDuplicates: true,
    });
    if (error) throw error;
  }

  return uniqueSlugs.length;
}

/** Lê o diretório público ao vivo e persiste somente a lista de slugs, nunca valores históricos do POC. */
export async function seedTieredPlatform(
  supabase: SupabaseClient,
  platformId: TieredPlatformId,
): Promise<number> {
  const source = DIRECTORY_SOURCES[platformId];
  const html = await fetchText(source.url, { Accept: DIRECTORY_ACCEPT });
  return seedCrawlStateSlugs(supabase, platformId, source.parse(html));
}

async function main(): Promise<void> {
  const platformId = SeedPlatform.parse(process.env.SEED_PLATFORM);
  const { url, key } = resolveSupabaseCredentials();
  const supabase = createClient(url, key);
  const targets: readonly TieredPlatformId[] = platformId ? [platformId] : TIERED_PLATFORM_IDS;

  for (const target of targets) {
    const slugs = await seedTieredPlatform(supabase, target);
    console.log(`[${target}] ${slugs} slugs lidos do diretório; slugs existentes em crawl_state foram preservados`);
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
