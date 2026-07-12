import {
  ParseError,
  RawOfferSchema,
  createClient,
  parseReward,
  type Reward,
  type ScrapeResult,
} from "@farejo/shared";
import { findOrCreateStore, type IntraPlatformCollision } from "./store.js";

type SupabaseClient = ReturnType<typeof createClient>;

export interface RunPipelineResult {
  offersWritten: number;
  parseErrors: number;
  anomalies: IntraPlatformCollision[];
}

// Índice explícito: é o que torna PreparedOfferRow[] estruturalmente um Json (o
// parâmetro jsonb do RPC) sem precisar de `as` — toda propriedade já é compatível.
interface PreparedOfferRow {
  [key: string]: string | number | boolean | null;
  store_id: number;
  reward_type: Reward["type"];
  value: number;
  value_partial: number | null;
  is_upto: boolean;
  raw_text: string;
  url: string;
}

/**
 * Coração do pipeline: RawOffer[] de um run já `ok` (o gate de sanity é o T9, roda
 * antes de chamar isto) → validação zod → parseReward → find-or-create → escrita
 * atômica por plataforma. Item malformado (zod) ou reward_text não reconhecido
 * (`parseReward`) conta em `parseErrors` e é pulado — não derruba o run.
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

  const rows: PreparedOfferRow[] = [];
  const anomalies: IntraPlatformCollision[] = [];
  let parseErrors = 0;

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
      continue;
    }

    let valuePartial: number | null = null;
    if (rawOffer.partialRewardText !== undefined) {
      const partial = safeParseReward(rawOffer.partialRewardText);
      if (!partial) {
        parseErrors++;
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

  const { error } = await supabase.rpc("pipeline_write_offers", {
    p_platform_id: platformId,
    p_run_started_at: runStartedAt.toISOString(),
    p_offers: rows,
  });
  if (error) throw error;

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
