/**
 * Throttle adaptativo INTER-run (ADR-0005 decisão 3) — avaliado 1x no fim de cada run
 * com desfecho, nunca dentro do run (rejeitado como YAGNI, ver ADR-0005). Histerese
 * deliberada entre `fallRatio` e `riseRatio`: evita oscilar a cada run.
 */
export const THROTTLE_THRESHOLDS = {
  /** Sobe um nível se abortado pelo circuit breaker OU softBlocks/rawCount > riseRatio. */
  riseRatio: 0.05,
  /** Desce um nível se o run completou com softBlocks/rawCount < fallRatio. */
  fallRatio: 0.02,
} as const;

export type ThrottleMultiplier = 1 | 2 | 4;

export interface ThrottleRunOutcome {
  /** true quando o run foi abortado por CircuitBreakerError (12 soft-blocks seguidos). */
  aborted: boolean;
  /** softBlocks / rawCount do run. */
  ratio: number;
}

const RISE: Record<ThrottleMultiplier, ThrottleMultiplier> = { 1: 2, 2: 4, 4: 4 };
const FALL: Record<ThrottleMultiplier, ThrottleMultiplier> = { 4: 2, 2: 1, 1: 1 };

export function nextThrottleMultiplier(current: ThrottleMultiplier, outcome: ThrottleRunOutcome): ThrottleMultiplier {
  if (outcome.aborted || outcome.ratio > THROTTLE_THRESHOLDS.riseRatio) return RISE[current];
  if (outcome.ratio < THROTTLE_THRESHOLDS.fallRatio) return FALL[current];
  return current;
}
