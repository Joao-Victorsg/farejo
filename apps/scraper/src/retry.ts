export interface RetryOptions {
  /** Quantas vezes tentar de novo depois da 1ª tentativa (2 retries = 3 tentativas no total). */
  retries: number;
  /** Backoff exponencial: tentativa N espera `baseDelayMs * 2^(N-1)`. */
  baseDelayMs: number;
  /** Injetável nos testes; default é um `setTimeout` real. */
  sleep?: (ms: number) => Promise<void>;
  /** Decide quais erros são transitórios; por padrão, preserva o retry genérico legado. */
  shouldRetry?: (error: unknown) => boolean;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Erro transitório (rede, timeout, HTTP não-2xx exceto 404 via `RetryableError`) → retry com backoff;
 * depois de esgotar `retries`, relança o último erro — quem chama decide o que isso significa
 * (no runner, T10: `failed`).
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? realSleep;
  const shouldRetry = opts.shouldRetry ?? (() => true);
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === opts.retries) break;
      if (!shouldRetry(err)) throw err;
      await sleep(opts.baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
import { RetryableError } from "@farejo/shared";
