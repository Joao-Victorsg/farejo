import { ParseError, RawOfferSchema, parseReward, type Reward, type ScrapeResult } from "@farejo/shared";
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
}

export interface PrepareOffersResult {
  rows: PreparedOfferRow[];
  parseErrors: number;
  anomalies: IntraPlatformCollision[];
  /** Até 5 rawText que o `parseReward` recusou — o que mais ajuda a diagnosticar um site que mudou. */
  parseErrorSamples: string[];
}

/**
 * Validação zod → `parseReward` → normalização de loja (find-or-create). Não escreve
 * nada em `offers`: separado de `writeOffers` para o gate de sanity (T9,
 * apps/scraper/src/pipeline/scrapeRun.ts) poder decidir escrever ou não usando estes
 * números, sem a escrita já ter acontecido. Item malformado (zod) ou `rewardText`/
 * `partialRewardText` não reconhecido conta em `parseErrors` e é pulado — não derruba o run.
 */
export async function prepareOffers(
  supabase: SupabaseClient,
  platformId: string,
  scrapeResult: ScrapeResult,
): Promise<PrepareOffersResult> {
  const rows: PreparedOfferRow[] = [];
  const anomalies: IntraPlatformCollision[] = [];
  const parseErrorSamples: string[] = [];
  let parseErrors = 0;

  const sample = (text: string) => {
    if (parseErrorSamples.length < MAX_PARSE_ERROR_SAMPLES) parseErrorSamples.push(text.slice(0, 80));
  };

  for (const raw of scrapeResult.offers) {
    const validated = RawOfferSchema.safeParse(raw);
    if (!validated.success) {
      parseErrors++;
      continue;
    }
    const rawOffer = validated.data;

    const reward = safeParseReward(rawOffer.rewardText);
    if (!reward) {
      parseErrors++;
      sample(rawOffer.rewardText);
      continue;
    }

    let valuePartial: number | null = null;
    if (rawOffer.partialRewardText !== undefined) {
      const partial = safeParseReward(rawOffer.partialRewardText);
      if (!partial) {
        parseErrors++;
        sample(rawOffer.partialRewardText);
        continue;
      }
      valuePartial = partial.value;
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
    });
  }

  return { rows, parseErrors, anomalies, parseErrorSamples };
}

/** Escrita atômica por plataforma (upsert `offers` + `offer_history` + desativação por escopo). */
export async function writeOffers(
  supabase: SupabaseClient,
  platformId: string,
  runStartedAt: Date,
  rows: PreparedOfferRow[],
): Promise<void> {
  const { error } = await supabase.rpc("pipeline_write_offers", {
    p_platform_id: platformId,
    p_run_started_at: runStartedAt.toISOString(),
    p_offers: rows,
  });
  if (error) throw error;
}

/**
 * Coração do pipeline, incondicional: prepara e escreve sempre, sem gate de sanity.
 * O gate (T9) decide ANTES se vale escrever, compondo `prepareOffers` + `writeOffers`
 * ele mesmo; isto aqui é para quem já decidiu que quer escrever de qualquer jeito.
 */
export async function runPipeline(
  supabase: SupabaseClient,
  platformId: string,
  scrapeResult: ScrapeResult,
  runStartedAt: Date,
): Promise<RunPipelineResult> {
  if (scrapeResult.scope.kind !== "full") {
    throw new Error(`runPipeline: escopo "${scrapeResult.scope.kind}" ainda não implementado (só "full" na Fase 1)`);
  }

  const { rows, parseErrors, anomalies } = await prepareOffers(supabase, platformId, scrapeResult);
  await writeOffers(supabase, platformId, runStartedAt, rows);

  return { offersWritten: rows.length, parseErrors, anomalies };
}

function safeParseReward(text: string) {
  try {
    return parseReward(text);
  } catch (err) {
    if (err instanceof ParseError) return null;
    throw err;
  }
}
