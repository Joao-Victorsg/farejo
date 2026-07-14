/**
 * Bloqueio ou anomalia de coleta (200 sem sinal de presença, timeout, HTTP não-2xx exceto 404):
 * desfecho retentável com backoff, nunca "sem cashback" (ver skill do adapter).
 */
export class RetryableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RetryableError";
  }
}

/**
 * A URL de loja não existe mais. É um desfecho real do crawl tiered, distinto de
 * bloqueio transitório: quem chama deve persistir `not_found`, sem retentar.
 */
export class NotFoundError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "NotFoundError";
  }
}

/**
 * Circuit breaker de coleta tiered (ADR-0005 decisão 1): 12 soft-blocks seguidos
 * aborta o crawl. Carrega o estado parcial até o abort, para que `runner.ts` (T6/#18)
 * grave os números reais em vez de zerar `softBlocks` no run abortado — o sinal que o
 * throttle adaptativo (`nextThrottleMultiplier`) precisa para subir de nível.
 * Nenhum crawler lança essa classe ainda (chega com os crawlers tiered, méliuz/cuponomia) —
 * `runner.ts` já distingue o catch, testado com adapters fake (T6).
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
