/**
 * Camada anticorrupção entre uma plataforma e o domínio (ADR-0001).
 * De RawOffer para dentro, a plataforma deixa de existir — nenhum campo aqui
 * é interpretação de valor, só extração crua.
 */
export interface RawOffer {
  storeName: string;
  rewardText: string;
  /** Boost nativo do site, ex.: "era 2%" (méliuz/cuponomia; inter via campo da API). */
  previousRewardText?: string;
  /** Tier inferior de acesso (inter: não-correntista). Genérico: shared não conhece "correntista". */
  partialRewardText?: string;
  url: string;
  logoUrl?: string;
}

/**
 * Escopo do run: só se pode desativar por ausência o que estava no escopo.
 * Union desde a Fase 1 (só `full` implementado) para o pipeline não mudar de
 * assinatura quando a coleta tiered chegar na Fase 2.
 */
export type RunScope = { kind: "full" } | { kind: "partial"; slugs: Set<string> };

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
}

export interface PlatformAdapter {
  platformId: string;
  scrape(): Promise<ScrapeResult>;
}
