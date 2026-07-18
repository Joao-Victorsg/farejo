import "dotenv/config";
import { pathToFileURL } from "node:url";
import { pickBestLogoSource } from "@farejo/shared";
import type { Pool } from "pg";
import { createCatalogInvalidator, type CatalogInvalidator } from "../catalogInvalidation.js";
import { normalizeLogoImage } from "./image.js";
import { getLogoWriterPool } from "./logoWriterDb.js";
import { safeFetchBytes, type SafeFetchOptions } from "./net.js";
import { createLogoStorage, logoObjectKey, type LogoStorage } from "./storage.js";

/**
 * Orquestração da ingestão de logos (F3/T15/#61, ADR-0014/ADR-0038/ADR-0042). Sem acesso a
 * `service_role`: usa só a role `farejo_logo_writer` (lê `store_logo_sources`/`stores`, escreve
 * o estado de verificação e o ponteiro final) e a chave S3 do bucket `store-logos`.
 */

// Interface mínima: permite injetar um fake de `pool.query` nos testes (ex.: simular falha
// APÓS o upload já ter acontecido) sem precisar de um Pool real do `pg`.
export interface LogoWriterPool {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface LogoSourceRow {
  platformId: string;
  url: string;
}

export interface CandidateStore {
  storeId: number;
  logoHash: string | null;
  sources: LogoSourceRow[];
}

export interface SelectCandidateStoresOptions {
  /**
   * Restringe a candidatura a este conjunto de lojas. Produção nunca passa isso (o
   * entrypoint real varre o catálogo inteiro); os testes de integração passam só os
   * `store_id` da própria fixture, para não competir com o estado deixado por outros
   * arquivos de teste `*-db.test.ts` rodando contra o mesmo Postgres local.
   */
  storeIds?: number[];
}

/**
 * Candidata = sem logo final OU com pelo menos uma fonte cuja `url` mudou desde a última
 * verificação (`verified_url`). Uma loja com logo final e todas as fontes já verificadas e
 * inalteradas não aparece aqui — é o que faz o entrypoint não reprocessar o catálogo inteiro
 * a cada execução.
 */
export async function selectCandidateStores(pool: LogoWriterPool, options: SelectCandidateStoresOptions = {}): Promise<CandidateStore[]> {
  const scopeFilter = options.storeIds ? "and s.id = any($1)" : "";
  const params = options.storeIds ? [options.storeIds] : [];

  const { rows: storeRows } = await pool.query<{ store_id: number; logo_hash: string | null }>(
    `select s.id as store_id, s.logo_hash
     from stores s
     where (
       s.logo_hash is null
       or exists (
         select 1 from store_logo_sources ls
         where ls.store_id = s.id and ls.url is distinct from ls.verified_url
       )
     )
     ${scopeFilter}
     order by s.id`,
    params,
  );

  const candidates: CandidateStore[] = [];
  for (const row of storeRows) {
    const { rows: sourceRows } = await pool.query<{ platform_id: string; url: string }>(
      "select platform_id, url from store_logo_sources where store_id = $1 order by platform_id",
      [row.store_id],
    );
    candidates.push({
      storeId: row.store_id,
      logoHash: row.logo_hash,
      sources: sourceRows.map((r) => ({ platformId: r.platform_id, url: r.url })),
    });
  }
  return candidates;
}

type SourceOutcome =
  | { platformId: string; status: "accepted"; width: number; height: number; contentHash: string; webp: Buffer }
  | { platformId: string; status: "rejected"; reason: string };

async function verifySource(source: LogoSourceRow, fetchOptions: SafeFetchOptions): Promise<SourceOutcome> {
  try {
    const { bytes } = await safeFetchBytes(source.url, fetchOptions);
    const normalized = await normalizeLogoImage(bytes);
    return {
      platformId: source.platformId,
      status: "accepted",
      width: normalized.sourceWidth,
      height: normalized.sourceHeight,
      contentHash: normalized.contentHash,
      webp: normalized.webp,
    };
  } catch (error) {
    return { platformId: source.platformId, status: "rejected", reason: error instanceof Error ? error.message : String(error) };
  }
}

async function persistVerification(pool: LogoWriterPool, storeId: number, outcome: SourceOutcome): Promise<void> {
  await pool.query(
    `update store_logo_sources
     set verified_url = url, verified_at = now(), verified_status = $3,
         rejection_reason = $4, content_hash = $5, width = $6, height = $7
     where store_id = $1 and platform_id = $2`,
    [
      storeId,
      outcome.platformId,
      outcome.status,
      outcome.status === "rejected" ? outcome.reason : null,
      outcome.status === "accepted" ? outcome.contentHash : null,
      outcome.status === "accepted" ? outcome.width : null,
      outcome.status === "accepted" ? outcome.height : null,
    ],
  );
}

export interface StoreResult {
  storeId: number;
  changed: boolean;
}

/**
 * Verifica TODAS as fontes da loja (não só as que mudaram — a seleção "nova/alterada" é por
 * LOJA, não por fonte: a fonte perdedora de hoje pode ganhar amanhã se uma melhor sumir), grava
 * o diagnóstico de cada uma, e só troca o ponteiro se a vencedora produzir um hash diferente do
 * logo atual — upload primeiro, ponteiro depois (ADR-0014): uma falha no upload nunca chega a
 * tocar `stores`, e uma falha no update do ponteiro (após upload OK) deixa o objeto órfão mas
 * inofensivo — o ponteiro anterior continua válido.
 */
export async function processStore(
  pool: LogoWriterPool,
  storage: LogoStorage,
  store: CandidateStore,
  fetchOptions: SafeFetchOptions = {},
): Promise<StoreResult> {
  const outcomes = await Promise.all(store.sources.map((source) => verifySource(source, fetchOptions)));
  for (const outcome of outcomes) {
    await persistVerification(pool, store.storeId, outcome);
  }

  const accepted = outcomes.filter((o): o is Extract<SourceOutcome, { status: "accepted" }> => o.status === "accepted");
  const winner = pickBestLogoSource(accepted.map((a) => ({ platformId: a.platformId, width: a.width, height: a.height })));
  if (!winner) return { storeId: store.storeId, changed: false };

  const winningOutcome = accepted.find((a) => a.platformId === winner.platformId)!;
  if (winningOutcome.contentHash === store.logoHash) return { storeId: store.storeId, changed: false };

  const key = logoObjectKey(store.storeId, winningOutcome.contentHash);
  await storage.upload(key, winningOutcome.webp);
  const publicUrl = storage.publicUrlFor(key);

  await pool.query("update stores set logo_url = $2, logo_hash = $3 where id = $1", [store.storeId, publicUrl, winningOutcome.contentHash]);

  return { storeId: store.storeId, changed: true };
}

export interface IngestSummary {
  storesConsidered: number;
  storesChanged: number;
  storesFailed: number;
  errors: Array<{ storeId: number; message: string }>;
}

/**
 * Loop sequencial por loja (o pool é `max: 1`, como `curationDb.ts`) — uma loja que falha
 * (ex.: upload OK mas update do ponteiro falhou) é registrada em `errors` e não impede as
 * demais. `invalidateCatalog` só dispara se ALGUMA loja de fato mudou de ponteiro (ADR-0038
 * consequências) — um run sem mudança não invalida `catalog` à toa.
 */
export async function ingestLogos(
  pool: LogoWriterPool,
  storage: LogoStorage,
  invalidateCatalog: CatalogInvalidator,
  fetchOptions: SafeFetchOptions = {},
  selectOptions: SelectCandidateStoresOptions = {},
): Promise<IngestSummary> {
  const candidates = await selectCandidateStores(pool, selectOptions);
  let changed = 0;
  let failed = 0;
  const errors: IngestSummary["errors"] = [];

  for (const store of candidates) {
    try {
      const result = await processStore(pool, storage, store, fetchOptions);
      if (result.changed) changed++;
    } catch (error) {
      failed++;
      errors.push({ storeId: store.storeId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (changed > 0) {
    await invalidateCatalog({ platformId: "logos", runId: 0, timestamp: new Date() });
  }

  return { storesConsidered: candidates.length, storesChanged: changed, storesFailed: failed, errors };
}

async function main(): Promise<void> {
  const pool = getLogoWriterPool();
  const storage = createLogoStorage();
  const summary = await ingestLogos(pool as unknown as Pool, storage, createCatalogInvalidator());

  console.log(`[logos] ${summary.storesConsidered} candidatas, ${summary.storesChanged} atualizadas, ${summary.storesFailed} falharam`);
  for (const err of summary.errors) {
    console.error(`[logos] loja ${err.storeId}: ${err.message}`);
  }

  if (summary.storesFailed > 0) process.exitCode = 1;
  await pool.end();
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
