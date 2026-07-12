/**
 * Sanity check do pipeline (docs/farejo-system-design.md §"Sanity check": a defesa
 * contra HTML que mudou). Puro — sem I/O; quem busca o baseline em `scrape_runs` e
 * decide se escreve é o pipeline em apps/scraper.
 */
export const SANITY_THRESHOLDS = {
  /** Regras 1/2: suspicious se < 60% da média dos últimos runs `ok`. */
  relativeFloor: 0.6,
  /** Regra 3: suspicious se parse_errors / offersFound > 10%. */
  parseErrorCeiling: 0.1,
  /** Cold-start: regras 1/2 só engatam com ≥3 runs `ok` de baseline. */
  minBaselineRuns: 3,
  /** Janela da média móvel usada no baseline (últimos N runs `ok`). */
  baselineWindow: 5,
} as const;

export interface SanityBaseline {
  /** Quantos runs `ok` entraram na média (pode ser < baselineWindow). */
  n: number;
  avgOffersFound: number | null;
  avgActiveOffers: number | null;
}

export interface SanityActual {
  /** = ScrapeResult.rawCount: itens recebidos, antes do filtro de inativas. */
  offersFound: number;
  /** = ScrapeResult.offers.length: ofertas com cashback que o adapter encontrou. */
  activeOffers: number;
  parseErrors: number;
  /** Só onde há total de máquina autoritativo (ex.: inter); null nos demais sites. */
  declaredTotal: number | null;
}

export type SanityTrip = "rule1_offers_found" | "rule2_active_offers" | "rule3_parse_errors" | "rule4_declared_vs_raw";

export interface SanityVerdict {
  verdict: "ok" | "suspicious";
  tripped: SanityTrip | null;
  /** true quando o baseline ainda não tem os ≥3 runs `ok` exigidos pelas regras 1/2. */
  coldStart: boolean;
}

/**
 * As quatro regras, nessa ordem de precedência (a primeira que disparar vence).
 * 1/2 são relativas ao baseline e ficam de fora no cold-start; 3/4 são absolutas
 * e sempre avaliadas — é o que deixa o primeiro run nascer o baseline.
 */
export function evaluateSanity(actual: SanityActual, baseline: SanityBaseline): SanityVerdict {
  const coldStart = baseline.n < SANITY_THRESHOLDS.minBaselineRuns;

  if (!coldStart) {
    if (baseline.avgOffersFound != null && actual.offersFound < baseline.avgOffersFound * SANITY_THRESHOLDS.relativeFloor) {
      return { verdict: "suspicious", tripped: "rule1_offers_found", coldStart };
    }
    if (
      baseline.avgActiveOffers != null &&
      actual.activeOffers < baseline.avgActiveOffers * SANITY_THRESHOLDS.relativeFloor
    ) {
      return { verdict: "suspicious", tripped: "rule2_active_offers", coldStart };
    }
  }

  if (actual.offersFound > 0 && actual.parseErrors / actual.offersFound > SANITY_THRESHOLDS.parseErrorCeiling) {
    return { verdict: "suspicious", tripped: "rule3_parse_errors", coldStart };
  }

  if (actual.declaredTotal != null && actual.declaredTotal !== actual.offersFound) {
    return { verdict: "suspicious", tripped: "rule4_declared_vs_raw", coldStart };
  }

  return { verdict: "ok", tripped: null, coldStart };
}
