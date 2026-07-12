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
