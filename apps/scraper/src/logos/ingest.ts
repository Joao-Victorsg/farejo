import "dotenv/config";
import { pathToFileURL } from "node:url";
import { pickBestLogoSource } from "@farejo/shared";
import { createCatalogInvalidator, type CatalogInvalidator } from "../catalogInvalidation.js";
import { InvalidImageError, normalizeLogoImage } from "./image.js";
import { getLogoWriterPool } from "./logoWriterDb.js";
import { DownloadTooLargeError, safeFetchBytes, UnsafeUrlError, type SafeFetchOptions } from "./net.js";
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
  | { platformId: string; status: "rejected"; reason: string; errorClass: RejectionClass; networkDetail: string | null };

/**
 * Classe do diagnóstico privado por falha (F3/T16/#62): nunca sai do log/console da Action
 * (`store_logo_sources.rejection_reason` já guarda a mensagem completa) — aqui é só um rótulo
 * agregável para o resumo do run, sem URL nem stack trace.
 */
export type RejectionClass = "unsafe_url" | "download_too_large" | "invalid_image" | "network_or_http";

function classifyRejection(error: unknown): RejectionClass {
  if (error instanceof UnsafeUrlError) return "unsafe_url";
  if (error instanceof DownloadTooLargeError) return "download_too_large";
  if (error instanceof InvalidImageError) return "invalid_image";
  return "network_or_http";
}

/**
 * Sub-rótulo de `network_or_http`, sujeito à mesma regra da classe: agregável, sem URL nem
 * stack. Existe porque "network_or_http" sozinho não distingue o que é nosso do que não é —
 * `http_404` é arquivo que a plataforma removeu (nada a corrigir aqui, fallback é a resposta
 * honesta), enquanto timeout ou erro de socket em massa aponta para o nosso lado, que foi
 * exatamente o caso da ADR-0057.
 */
export function networkFailureDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const httpStatus = /^HTTP (\d{3})\b/.exec(message);
  if (httpStatus) return `http_${httpStatus[1]}`;

  const code = (error as { cause?: { code?: unknown } }).cause?.code ?? (error as { code?: unknown }).code;
  if (typeof code === "string") return code.toLowerCase();
  return error instanceof Error && error.name !== "Error" ? error.name.toLowerCase() : "other";
}

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
    return {
      platformId: source.platformId,
      status: "rejected",
      reason: error instanceof Error ? error.message : String(error),
      errorClass: classifyRejection(error),
      networkDetail: classifyRejection(error) === "network_or_http" ? networkFailureDetail(error) : null,
    };
  }
}

function verificationColumns(outcome: SourceOutcome): {
  status: SourceOutcome["status"];
  reason: string | null;
  contentHash: string | null;
  width: number | null;
  height: number | null;
} {
  switch (outcome.status) {
    case "accepted":
      return { status: "accepted", reason: null, contentHash: outcome.contentHash, width: outcome.width, height: outcome.height };
    case "rejected":
      return { status: "rejected", reason: outcome.reason, contentHash: null, width: null, height: null };
  }
}

async function persistVerification(pool: LogoWriterPool, storeId: number, outcome: SourceOutcome): Promise<void> {
  const columns = verificationColumns(outcome);
  await pool.query(
    `update store_logo_sources
     set verified_url = url, verified_at = now(), verified_status = $3,
         rejection_reason = $4, content_hash = $5, width = $6, height = $7
     where store_id = $1 and platform_id = $2`,
    [storeId, outcome.platformId, columns.status, columns.reason, columns.contentHash, columns.width, columns.height],
  );
}

export interface StoreResult {
  storeId: number;
  changed: boolean;
  /** Falso quando a loja termina o run sem nenhum logo final — segue no fallback visual. */
  hasFinalLogo: boolean;
  rejections: Array<{ platformId: string; errorClass: RejectionClass; networkDetail: string | null }>;
}

/**
 * Verifica TODAS as fontes da loja (não só as que mudaram — a seleção "nova/alterada" é por
 * LOJA, não por fonte: a fonte perdedora de hoje pode ganhar amanhã se uma melhor sumir), e só
 * troca o ponteiro se a vencedora produzir um hash diferente do logo atual — upload primeiro,
 * ponteiro depois (ADR-0014): uma falha no upload nunca chega a tocar `stores`.
 *
 * O diagnóstico de verificação (`persistVerification`) só é gravado DEPOIS que a parte
 * arriscada (upload + troca de ponteiro) já terminou com sucesso — ou quando não havia nada
 * arriscado a fazer (sem vencedor, ou vencedor já é o ponteiro atual). Se o upload ou o update
 * do ponteiro falhar, a verificação fica de fora de propósito: gravar `verified_url = url` ali
 * faria a loja parecer "já processada" (url == verified_url) mesmo com `stores.logo_hash`
 * continuando desatualizado — presa para sempre, sem `selectCandidateStores` nunca mais
 * escolhê-la de novo. Deixando a verificação por gravar, a loja continua candidata e o próximo
 * run tenta tudo de novo.
 */
export async function processStore(
  pool: LogoWriterPool,
  storage: LogoStorage,
  store: CandidateStore,
  fetchOptions: SafeFetchOptions = {},
): Promise<StoreResult> {
  const outcomes = await Promise.all(store.sources.map((source) => verifySource(source, fetchOptions)));

  const accepted = outcomes.filter((o): o is Extract<SourceOutcome, { status: "accepted" }> => o.status === "accepted");
  const rejections = outcomes
    .filter((o): o is Extract<SourceOutcome, { status: "rejected" }> => o.status === "rejected")
    .map((o) => ({ platformId: o.platformId, errorClass: o.errorClass, networkDetail: o.networkDetail }));
  const winner = pickBestLogoSource(accepted.map((a) => ({ platformId: a.platformId, width: a.width, height: a.height })));
  const winningOutcome = winner ? accepted.find((a) => a.platformId === winner.platformId)! : null;

  if (winningOutcome && winningOutcome.contentHash !== store.logoHash) {
    const key = logoObjectKey(store.storeId, winningOutcome.contentHash);
    await storage.upload(key, winningOutcome.webp);
    const publicUrl = storage.publicUrlFor(key);
    await pool.query("update stores set logo_url = $2, logo_hash = $3 where id = $1", [store.storeId, publicUrl, winningOutcome.contentHash]);

    for (const outcome of outcomes) await persistVerification(pool, store.storeId, outcome);
    return { storeId: store.storeId, changed: true, hasFinalLogo: true, rejections };
  }

  for (const outcome of outcomes) await persistVerification(pool, store.storeId, outcome);
  const hasFinalLogo = winningOutcome !== null || store.logoHash !== null;
  return { storeId: store.storeId, changed: false, hasFinalLogo, rejections };
}

export interface IngestSummary {
  storesConsidered: number;
  storesChanged: number;
  storesFailed: number;
  /** Candidatas que terminaram o run ainda sem logo final — seguem no avatar de fallback. */
  storesFallback: number;
  /** Diagnóstico privado por classe de falha (F3/T16/#62) — só contagens, nunca URL/reason cru. */
  rejectionsByClass: Record<RejectionClass, number>;
  /** Detalhe agregado das falhas `network_or_http` (`http_404`, `etimedout`, …), mesma regra. */
  networkFailureDetails: Record<string, number>;
  errors: Array<{ storeId: number; message: string }>;
  /**
   * Falha ao sinalizar a invalidação do catálogo, se houve. Fica no resumo em vez de subir
   * como exceção porque nesse ponto os ponteiros JÁ foram gravados: deixar a exceção escapar
   * descartava todo o diagnóstico de um run de 27 minutos (ADR-0057). O run continua falhando,
   * só que depois de dizer o que fez — o catálogo se corrige sozinho no TTL de ~1 h.
   */
  catalogInvalidationError: string | null;
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
  let fallback = 0;
  const rejectionsByClass: IngestSummary["rejectionsByClass"] = {
    unsafe_url: 0,
    download_too_large: 0,
    invalid_image: 0,
    network_or_http: 0,
  };
  const networkFailureDetails: IngestSummary["networkFailureDetails"] = {};
  const errors: IngestSummary["errors"] = [];

  for (const store of candidates) {
    try {
      const result = await processStore(pool, storage, store, fetchOptions);
      if (result.changed) changed++;
      if (!result.hasFinalLogo) fallback++;
      for (const rejection of result.rejections) {
        rejectionsByClass[rejection.errorClass]++;
        if (rejection.networkDetail) networkFailureDetails[rejection.networkDetail] = (networkFailureDetails[rejection.networkDetail] ?? 0) + 1;
      }
    } catch (error) {
      failed++;
      errors.push({ storeId: store.storeId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  let catalogInvalidationError: string | null = null;
  if (changed > 0) {
    try {
      await invalidateCatalog({ platformId: "logos", runId: 0, timestamp: new Date() });
    } catch (error) {
      catalogInvalidationError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    storesConsidered: candidates.length,
    storesChanged: changed,
    storesFailed: failed,
    storesFallback: fallback,
    rejectionsByClass,
    networkFailureDetails,
    errors,
    catalogInvalidationError,
  };
}

async function main(): Promise<void> {
  const pool = getLogoWriterPool();
  const storage = createLogoStorage();
  const summary = await ingestLogos(pool, storage, createCatalogInvalidator());

  console.log(
    `[logos] ${summary.storesConsidered} candidatas, ${summary.storesChanged} atualizadas, ${summary.storesFailed} falharam, ${summary.storesFallback} seguem no fallback visual`,
  );
  const rejectionBreakdown = Object.entries(summary.rejectionsByClass)
    .filter(([, count]) => count > 0)
    .map(([errorClass, count]) => `${errorClass}=${count}`)
    .join(", ");
  if (rejectionBreakdown) console.log(`[logos] fontes rejeitadas por classe: ${rejectionBreakdown}`);
  const networkBreakdown = Object.entries(summary.networkFailureDetails)
    .sort(([, a], [, b]) => b - a)
    .map(([detail, count]) => `${detail}=${count}`)
    .join(", ");
  if (networkBreakdown) console.log(`[logos] falhas de rede por detalhe: ${networkBreakdown}`);
  for (const err of summary.errors) {
    console.error(`[logos] loja ${err.storeId}: ${err.message}`);
  }
  if (summary.catalogInvalidationError) {
    console.error(`[logos] invalidação do catálogo falhou (ponteiros já gravados): ${summary.catalogInvalidationError}`);
  }

  if (summary.storesFailed > 0 || summary.catalogInvalidationError) process.exitCode = 1;
  await pool.end();
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
