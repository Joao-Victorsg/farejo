import type { CanonicalStoreView } from "@farejo/shared";
import { z } from "zod";
import type { SupabaseClient } from "../supabaseClient.js";

const PAGE_SIZE = 1000;

const StoreRow = z.object({ id: z.number(), slug: z.string(), name: z.string() });
const StoreAliasRow = z.object({ store_id: z.number().nullable(), platform_id: z.string(), raw_name: z.string() });

/**
 * PostgREST devolve no máximo 1000 linhas por request por padrão — `stores` já passa
 * disso (docs/farejo-recon-e-plano.md: ~1063 lojas canônicas). Sem paginar em `.range()`,
 * o restante fica silenciosamente de fora dos candidatos, sem erro nenhum.
 */
async function selectAllPages<Row>(
  schema: z.ZodType<Row>,
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    for (const raw of data ?? []) rows.push(schema.parse(raw));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

/**
 * Lê o estado canônico atual (`stores` + `store_aliases`) para alimentar a geração de
 * candidatos (F3/T13, #59). Somente leitura, via o mesmo cliente service_role que o
 * resto do scraper usa — a role de curadoria (`FAREJO_CURATION_DATABASE_URL`) só tem
 * EXECUTE em `curation.apply_alias_merge`, nunca SELECT direto em `stores`/`store_aliases`.
 */
export async function fetchCanonicalStores(supabase: SupabaseClient): Promise<CanonicalStoreView[]> {
  const stores = await selectAllPages(StoreRow, (from, to) => supabase.from("stores").select("id, slug, name").range(from, to));
  const aliases = await selectAllPages(StoreAliasRow, (from, to) => supabase.from("store_aliases").select("store_id, platform_id, raw_name").range(from, to));

  const aliasesByStoreId = new Map<number, { platformId: string; rawName: string }[]>();
  for (const alias of aliases) {
    if (alias.store_id == null) continue;
    const existing = aliasesByStoreId.get(alias.store_id);
    const entry = { platformId: alias.platform_id, rawName: alias.raw_name };
    if (existing) existing.push(entry);
    else aliasesByStoreId.set(alias.store_id, [entry]);
  }

  const sortAliases = (list: { platformId: string; rawName: string }[]) =>
    [...list].sort((a, b) => a.platformId.localeCompare(b.platformId) || a.rawName.localeCompare(b.rawName));

  return stores
    .map((row) => ({
      canonicalSlug: row.slug,
      name: row.name,
      aliases: sortAliases(aliasesByStoreId.get(row.id) ?? []),
    }))
    .filter((view) => view.aliases.length > 0);
}
