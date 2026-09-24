import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@farejo/shared";
import { Client } from "pg";
import { z } from "zod";
import { cuponomiaAdapter } from "../cuponomia.js";
import { LOCAL_SERVICE_ROLE_KEY, LOCAL_URL } from "../localDb.js";
import { meliuzAdapter } from "../meliuz.js";
import { runBootstrapPlatform } from "../runner.js";

const Inventory = z.object({ stores: z.array(z.object({
  slug: z.string(), platform_links: z.array(z.object({ url: z.string().url(), platform_id: z.string() })),
})) });
const inventory = Inventory.parse(JSON.parse(await readFile(resolve(import.meta.dirname, "../../../../docs/research/categorias-catalogo-2026-09-10/inventario.json"), "utf8")));
const wanted = new Set(["mercadolivre", "shopee", "magazineluiza", "carrefour"]);
const targets = inventory.stores.filter((store) => wanted.has(store.slug)).flatMap((store) => store.platform_links.flatMap((link) => {
  if (link.platform_id !== "cuponomia" && link.platform_id !== "meliuz") return [];
  const slug = new URL(link.url).pathname.split("/").filter(Boolean).at(-1);
  return slug ? [{ platformId: link.platform_id, slug }] : [];
}));
const client = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });
await client.connect();
try {
  for (const target of targets) {
    await client.query("insert into public.crawl_state (platform_id, slug) values ($1, $2) on conflict (platform_id, slug) do nothing", [target.platformId, target.slug]);
  }
} finally {
  await client.end();
}
const supabase = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY);
for (const [platformId, adapter] of [["cuponomia", cuponomiaAdapter], ["meliuz", meliuzAdapter]] as const) {
  const count = targets.filter((target) => target.platformId === platformId).length;
  console.log(await runBootstrapPlatform(supabase, adapter, count));
}
