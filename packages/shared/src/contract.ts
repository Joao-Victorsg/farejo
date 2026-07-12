import { z } from "zod";
import type { ThrottleMultiplier } from "./throttle.js";

/**
 * Camada anticorrupção entre uma plataforma e o domínio (ADR-0001).
 * De RawOffer para dentro, a plataforma deixa de existir — nenhum campo aqui
 * é interpretação de valor, só extração crua. Schema zod (ADR-0002): o pipeline
 * valida cada oferta crua antes de interpretar; item malformado conta como
 * `parse_error`, não derruba o run.
 */
export const RawOfferSchema = z.object({
  storeName: z.string(),
  rewardText: z.string(),
  /** Boost nativo do site, ex.: "era 2%" (méliuz/cuponomia; inter via campo da API). */
  previousRewardText: z.string().optional(),
  /** Tier inferior de acesso (inter: não-correntista). Genérico: shared não conhece "correntista". */
  partialRewardText: z.string().optional(),
  url: z.string(),
  logoUrl: z.string().optional(),
});

export type RawOffer = z.infer<typeof RawOfferSchema>;

/**
 * Escopo do run: só se pode desativar por ausência o que estava no escopo.
 * Union desde a Fase 1 (só `full` implementado) para o pipeline não mudar de
 * assinatura quando a coleta tiered chegar na Fase 2.
 */
export type RunScope = { kind: "full" } | { kind: "partial"; slugs: Set<string> };

/**
 * Desfecho por slug de uma coleta tiered (ADR-0005): união discriminada, nunca campos
 * opcionais por variante (farejo-typescript §2) — `offer` é o único desfecho que carrega
 * um `RawOffer`, os demais só confirmam que o slug foi visitado.
 */
export type SlugOutcome =
  | { slug: string; outcome: "offer"; offer: RawOffer }
  | { slug: string; outcome: "no_cashback" | "not_found" | "soft_block" };

/**
 * Parâmetro de entrada do `scrape()` (ADR-0005 decisão 4). O runner monta a instrução
 * (lê `crawl_state`/`platforms.throttle_multiplier`) sem dar ao adapter acesso a Supabase
 * (ADR-0002 preservado). `delay_base` fica de fora: é constante do próprio adapter, não
 * viaja na instrução.
 */
export type ScrapeInstruction = {
  throttleMultiplier: ThrottleMultiplier;
  target: { kind: "full" } | { kind: "slugs"; slugs: string[] };
};

/**
 * Metadados de coleta que só o adapter observa (ADR-0001) — declaredTotal,
 * rawCount e softBlocks não são interpretação, e o pipeline decide o veredito.
 */
export interface ScrapeResult {
  offers: RawOffer[];
  scope: RunScope;
  /** Só preenchido onde há total de MÁQUINA autoritativo (inter, zoom). */
  declaredTotal?: number;
  /** Itens recebidos com desfecho real, ANTES do filtro de inativas. */
  rawCount: number;
  softBlocks: number;
  /** Só preenchido por coleta tiered (méliuz, cuponomia); ausente nos sites de 1 request. */
  outcomes?: SlugOutcome[];
}

export interface PlatformAdapter {
  platformId: string;
  scrape(instruction: ScrapeInstruction): Promise<ScrapeResult>;
}
