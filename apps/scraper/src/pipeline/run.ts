import { ParseError, RawOfferSchema, parseReward, type RawOffer, type Reward, type ScrapeResult } from "@farejo/shared";
import type { SupabaseClient } from "../supabaseClient.js";
import { findOrCreateStore, type IntraPlatformCollision } from "./store.js";

const MAX_PARSE_ERROR_SAMPLES = 5;

export interface RunPipelineResult {
  offersWritten: number;
  parseErrors: number;
  anomalies: IntraPlatformCollision[];
}

// Índice explícito: é o que torna PreparedOfferRow[] estruturalmente um Json (o
// parâmetro jsonb do RPC) sem precisar de `as` — toda propriedade já é compatível.
export interface PreparedOfferRow {
  [key: string]: string | number | boolean | null;
  store_id: number;
  reward_type: Reward["type"];
  value: number;
  value_partial: number | null;
  is_upto: boolean;
  raw_text: string;
  url: string;
  previous_reward_type: Reward["type"] | null;
  previous_value: number | null;
  previous_raw_text: string | null;
}

/**
 * Um item por `SlugOutcome` que NÃO é `soft_block` (ADR-0001/ADR-0004): o que
 * `pipeline_write_offers` usa para sincronizar `crawl_state` na mesma transação da
 * escrita de `offers`. `store_id` só vem preenchido em `outcome: "offer"` (resolvido
 * pelo find-or-create); em `no_cashback`/`not_found` fica `null` — a função SQL nunca
 * sobrescreve o `store_id` já gravado nesses dois desfechos.
 */
export interface CrawlStateOutcomeRow {
  [key: string]: string | number | null;
  slug: string;
  outcome: "offer" | "no_cashback" | "not_found";
  store_id: number | null;
}

export interface PrepareOffersResult {
  rows: PreparedOfferRow[];
  parseErrors: number;
  anomalies: IntraPlatformCollision[];
  /** Até 5 rawText que o `parseReward` recusou — o que mais ajuda a diagnosticar um site que mudou. */
  parseErrorSamples: string[];
  /** Vazio quando `scrapeResult.outcomes` está ausente (sites full-scope sem crawl_state). */
  crawlStateRows: CrawlStateOutcomeRow[];
}

/**
 * Validação zod → `parseReward` → normalização de loja (find-or-create). Não escreve
 * nada em `offers`: separado de `writeOffers` para o gate de sanity (T9,
 * apps/scraper/src/pipeline/scrapeRun.ts) poder decidir escrever ou não usando estes
 * números, sem a escrita já ter acontecido. Item malformado (zod) ou `rewardText`/
 * `partialRewardText` não reconhecido conta em `parseErrors` e é pulado — não derruba o run.
 *
 * Quando `scrapeResult.outcomes` está presente (T4/#16, sites com `crawl_state`), a
 * iteração é sobre `outcomes` — a fonte autoritativa por slug — em vez de `offers`, e
 * cada item vira também uma `CrawlStateOutcomeRow` (exceto `soft_block`, que nunca
 * sincroniza `crawl_state`, ADR-0001). Sem `outcomes`, comportamento idêntico à Fase 1.
 */
export async function prepareOffers(
  supabase: SupabaseClient,
  platformId: string,
  scrapeResult: ScrapeResult,
): Promise<PrepareOffersResult> {
  const rows: PreparedOfferRow[] = [];
  const anomalies: IntraPlatformCollision[] = [];
  const parseErrorSamples: string[] = [];
  const crawlStateRows: CrawlStateOutcomeRow[] = [];
  let parseErrors = 0;

  const sample = (text: string) => {
    if (parseErrorSamples.length < MAX_PARSE_ERROR_SAMPLES) parseErrorSamples.push(text.slice(0, 80));
  };

  const processOffer = async (raw: RawOffer): Promise<number | null> => {
    const validated = RawOfferSchema.safeParse(raw);
    if (!validated.success) {
      parseErrors++;
      return null;
    }
    const rawOffer = validated.data;

    const reward = safeParseReward(rawOffer.rewardText);
    if (!reward) {
      parseErrors++;
      sample(rawOffer.rewardText);
      return null;
    }

    let valuePartial: number | null = null;
    if (rawOffer.partialRewardText !== undefined) {
      const partial = safeParseReward(rawOffer.partialRewardText);
      if (!partial) {
        parseErrors++;
        sample(rawOffer.partialRewardText);
        return null;
      }
      valuePartial = partial.value;
    }

    // "era 2%"/`previousCashback` é apoio de apresentação (ADR-0013), não um dado
    // essencial da oferta: um texto que não parseia vira ausência, nunca um parse_error
    // que descartaria a oferta inteira por causa de um snapshot acessório.
    let previous: Reward | null = null;
    let previousRawText: string | null = null;
    if (rawOffer.previousRewardText !== undefined) {
      const parsedPrevious = safeParseReward(rawOffer.previousRewardText);
      if (parsedPrevious) {
        previous = parsedPrevious;
        previousRawText = rawOffer.previousRewardText;
      }
    }

    const { storeId, anomaly } = await findOrCreateStore(supabase, platformId, rawOffer.storeName);
    if (anomaly) anomalies.push(anomaly);

    rows.push({
      store_id: storeId,
      reward_type: reward.type,
      value: reward.value,
      value_partial: valuePartial,
      is_upto: reward.type === "percent" ? reward.isUpto : false,
      raw_text: rawOffer.rewardText,
      url: rawOffer.url,
      previous_reward_type: previous?.type ?? null,
      previous_value: previous?.value ?? null,
      previous_raw_text: previousRawText,
    });

    return storeId;
  };

  if (scrapeResult.outcomes) {
    for (const outcome of scrapeResult.outcomes) {
      switch (outcome.outcome) {
        case "soft_block":
          break;
        case "no_cashback":
        case "not_found":
          crawlStateRows.push({ slug: outcome.slug, outcome: outcome.outcome, store_id: null });
          break;
        case "offer": {
          const storeId = await processOffer(outcome.offer);
          // Sem storeId (parse_error), não há o que "gravar como store_id resolvido" —
          // não sincroniza crawl_state pra este slug (nem tier nem last_checked_at), o
          // mesmo tratamento de "continua vencido" do soft_block. O parse_error já foi
          // contado; o slug tenta de novo na próxima fatia.
          if (storeId != null) {
            crawlStateRows.push({ slug: outcome.slug, outcome: "offer", store_id: storeId });
          }
          break;
        }
      }
    }
  } else {
    for (const raw of scrapeResult.offers) {
      await processOffer(raw);
    }
  }

  return { rows, parseErrors, anomalies, parseErrorSamples, crawlStateRows };
}

export interface WriteOffersOptions {
  /**
   * União de `{store_id das ofertas escritas}` ∪ `{crawl_state.store_id não-nulo dos
   * slugs no_cashback/not_found deste run}` (ADR-0004 decisão 2). `undefined` preserva
   * o comportamento full-scope da Fase 1 (desativa a plataforma inteira); array
   * (inclusive vazio) restringe a desativação por ausência a esse conjunto.
   */
  scopeStoreIds?: number[];
  /** Sincroniza `crawl_state` na mesma transação — ausente em sites sem `crawl_state`. */
  crawlStateRows?: CrawlStateOutcomeRow[];
}

/** Escrita atômica por plataforma (upsert `offers` + `offer_history` + desativação por escopo + crawl_state). */
export async function writeOffers(
  supabase: SupabaseClient,
  platformId: string,
  runStartedAt: Date,
  rows: PreparedOfferRow[],
  options: WriteOffersOptions = {},
): Promise<void> {
  const { error } = await supabase.rpc("pipeline_write_offers", {
    p_platform_id: platformId,
    p_run_started_at: runStartedAt.toISOString(),
    p_offers: rows,
    ...(options.scopeStoreIds !== undefined ? { p_scope_store_ids: options.scopeStoreIds } : {}),
    ...(options.crawlStateRows !== undefined ? { p_outcomes: options.crawlStateRows } : {}),
  });
  if (error) throw error;
}

/**
 * Coração do pipeline, incondicional: prepara e escreve sempre, sem gate de sanity.
 * O gate (T9) decide ANTES se vale escrever, compondo `prepareOffers` + `writeOffers`
 * ele mesmo; isto aqui é para quem já decidiu que quer escrever de qualquer jeito.
 *
 * Escopo `partial` só é aceito quando `scrapeResult.outcomes` está presente (T4/#16):
 * é dele que `p_scope_store_ids` é computado, não de `scope.slugs`. Sem `outcomes`,
 * `partial` continua "ainda não implementado" — não há como escrever a desativação
 * restrita sem saber qual desfecho cada slug teve.
 */
export async function runPipeline(
  supabase: SupabaseClient,
  platformId: string,
  scrapeResult: ScrapeResult,
  runStartedAt: Date,
): Promise<RunPipelineResult> {
  assertScopeHasOutcomes(scrapeResult);

  const prepared = await prepareOffers(supabase, platformId, scrapeResult);
  const options = await buildWriteOffersOptions(supabase, platformId, scrapeResult, prepared);
  await writeOffers(supabase, platformId, runStartedAt, prepared.rows, options);

  return { offersWritten: prepared.rows.length, parseErrors: prepared.parseErrors, anomalies: prepared.anomalies };
}

/**
 * Guarda compartilhada entre `runPipeline` e o gate de sanity (T9, `scrapeRun.ts`):
 * escopo `partial` sem `outcomes` não sabe qual desfecho cada slug teve, então não há
 * como computar `p_scope_store_ids` nem sincronizar `crawl_state` — "ainda não
 * implementado", não um caso de negócio silencioso.
 */
export function assertScopeHasOutcomes(scrapeResult: Pick<ScrapeResult, "scope" | "outcomes">): void {
  if (scrapeResult.scope.kind !== "full" && !scrapeResult.outcomes) {
    throw new Error(`runPipeline: escopo "${scrapeResult.scope.kind}" sem outcomes ainda não implementado`);
  }
}

/**
 * Monta as opções de `writeOffers` a partir do que `prepareOffers` já preparou (T4/#16,
 * reusado pelo gate de sanity em T11/#23 — antes disso `runPlatformScrape` escrevia sem
 * nunca sincronizar `crawl_state`, o que faria `pipeline_write_offers` rejeitar qualquer
 * plataforma tiered por `p_scope_store_ids` chegar `null` com linhas em `crawl_state`).
 * `{}` sem `outcomes`: sites full-scope sem `crawl_state` preservam o comportamento da Fase 1.
 */
export async function buildWriteOffersOptions(
  supabase: SupabaseClient,
  platformId: string,
  scrapeResult: Pick<ScrapeResult, "outcomes">,
  prepared: Pick<PrepareOffersResult, "rows" | "crawlStateRows">,
): Promise<WriteOffersOptions> {
  if (!scrapeResult.outcomes) return {};
  return {
    crawlStateRows: prepared.crawlStateRows,
    scopeStoreIds: await computeScopeStoreIds(supabase, platformId, prepared.rows, prepared.crawlStateRows),
  };
}

/**
 * `p_scope_store_ids` (ADR-0004 decisão 2): união de `{store_id das ofertas escritas}`
 * ∪ `{crawl_state.store_id não-nulo dos slugs no_cashback/not_found deste run}`. A
 * leitura é do estado ANTES desta escrita (o `store_id` retido de um `offer` anterior) —
 * é uma leitura, não faz parte da atomicidade que a escrita (RPC) garante.
 */
async function computeScopeStoreIds(
  supabase: SupabaseClient,
  platformId: string,
  rows: PreparedOfferRow[],
  crawlStateRows: CrawlStateOutcomeRow[],
): Promise<number[]> {
  const storeIds = new Set<number>(rows.map((row) => row.store_id));

  const slugsNeedingLookup = crawlStateRows.filter((row) => row.outcome !== "offer").map((row) => row.slug);
  if (slugsNeedingLookup.length > 0) {
    const { data, error } = await supabase
      .from("crawl_state")
      .select("store_id")
      .eq("platform_id", platformId)
      .in("slug", slugsNeedingLookup)
      .not("store_id", "is", null);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.store_id != null) storeIds.add(row.store_id);
    }
  }

  return [...storeIds];
}

function safeParseReward(text: string) {
  try {
    return parseReward(text);
  } catch (err) {
    if (err instanceof ParseError) return null;
    throw err;
  }
}
