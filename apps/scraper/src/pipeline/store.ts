import { l2Key } from "@farejo/shared";
import type { SupabaseClient } from "../supabaseClient.js";

const UNIQUE_VIOLATION = "23505";

/** Colisão intra-plataforma pós-L2: dois nomes crus da MESMA plataforma caem no mesmo store_id. */
export interface IntraPlatformCollision {
  platformId: string;
  storeId: number;
  /** Todos os nomes crus dessa plataforma que apontam pro store_id, incluindo o novo. */
  rawNames: string[];
}

export interface FindOrCreateStoreResult {
  storeId: number;
  anomaly: IntraPlatformCollision | null;
}

/**
 * Passo de normalização do pipeline: nome cru de uma plataforma → loja canônica.
 * Camadas 1/2/3/5 do design (docs/farejo-system-design.md §5.1); a camada 4
 * (trigram → fila `review`) é Fase 3 — aqui é só chave L2 exata.
 * Nunca sobrescreve `stores.name`: nome canônico é first-writer-wins.
 */
export async function findOrCreateStore(
  supabase: SupabaseClient,
  platformId: string,
  rawName: string,
): Promise<FindOrCreateStoreResult> {
  // Camada 2: alias exato já conhecido — resolve sem tocar em `stores`.
  const { data: existingAlias, error: aliasLookupError } = await supabase
    .from("store_aliases")
    .select("store_id")
    .eq("platform_id", platformId)
    .eq("raw_name", rawName)
    .maybeSingle();
  if (aliasLookupError) throw aliasLookupError;
  if (existingAlias?.store_id != null) {
    return { storeId: existingAlias.store_id, anomaly: null };
  }

  const slug = l2Key(rawName);
  const storeId = await findOrCreateCanonicalStore(supabase, slug, rawName);

  // Antes de gravar o novo alias: outro nome cru da MESMA plataforma já aponta pra
  // esse store_id? Isso é colisão pós-L2 — loga, não bloqueia (a escolha é determinística:
  // o alias novo é criado do mesmo jeito, convergindo pra loja já resolvida).
  const { data: siblings, error: siblingsError } = await supabase
    .from("store_aliases")
    .select("raw_name")
    .eq("platform_id", platformId)
    .eq("store_id", storeId);
  if (siblingsError) throw siblingsError;

  const { error: insertAliasError } = await supabase
    .from("store_aliases")
    .insert({ platform_id: platformId, raw_name: rawName, store_id: storeId, confidence: "auto" });
  if (insertAliasError) throw insertAliasError;

  if (!siblings || siblings.length === 0) {
    return { storeId, anomaly: null };
  }

  const anomaly: IntraPlatformCollision = {
    platformId,
    storeId,
    rawNames: [...siblings.map((s) => s.raw_name), rawName],
  };
  console.warn(
    `[normalize] colisão intra-plataforma: "${platformId}" tem ${anomaly.rawNames.length} nomes crus no mesmo store_id=${storeId}: ${anomaly.rawNames.join(" | ")}`,
  );
  return { storeId, anomaly };
}

// Camadas 3 e 5: slug (== chave L2) já existe como loja canônica? Senão, cria.
async function findOrCreateCanonicalStore(
  supabase: SupabaseClient,
  slug: string,
  rawName: string,
): Promise<number> {
  const { data: existingStore, error: storeLookupError } = await supabase
    .from("stores")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (storeLookupError) throw storeLookupError;
  if (existingStore) return existingStore.id;

  const { data: newStore, error: insertStoreError } = await supabase
    .from("stores")
    .insert({ slug, name: rawName })
    .select("id")
    .single();
  if (!insertStoreError) return newStore.id;
  if (insertStoreError.code !== UNIQUE_VIOLATION) throw insertStoreError;

  // Corrida: outro find-or-create criou a mesma loja entre o select e o insert acima.
  // First-writer-wins vale aqui também — usa quem chegou primeiro, não sobrescreve.
  const { data: raceWinner, error: raceLookupError } = await supabase
    .from("stores")
    .select("id")
    .eq("slug", slug)
    .single();
  if (raceLookupError) throw raceLookupError;
  return raceWinner.id;
}
