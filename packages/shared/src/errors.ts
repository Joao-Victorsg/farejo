/**
 * Bloqueio ou anomalia de coleta (200 sem sinal de presença, timeout, HTTP não-2xx):
 * desfecho retentável com backoff, nunca "sem cashback" (ver skill do adapter).
 */
export class RetryableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RetryableError";
  }
}

/**
 * Circuit breaker de coleta tiered (ADR-0005 decisão 1): 12 soft-blocks seguidos
 * aborta o crawl. Carrega o estado parcial até o abort, para que `runner.ts` grave
 * os números reais em vez de zerar `softBlocks` no run abortado — o sinal que o
 * throttle adaptativo (`nextThrottleMultiplier`) precisa para subir de nível.
 * Fundação tipada (T2): nenhum crawler lança essa classe ainda, e `runner.ts` ainda
 * não a distingue no catch — chega com os crawlers tiered (méliuz/cuponomia).
 */
export class CircuitBreakerError extends Error {
  readonly softBlocksSoFar: number;
  readonly rawCountSoFar: number;

  constructor(reason: string, details: { softBlocksSoFar: number; rawCountSoFar: number }) {
    super(reason);
    this.name = "CircuitBreakerError";
    this.softBlocksSoFar = details.softBlocksSoFar;
    this.rawCountSoFar = details.rawCountSoFar;
  }
}
