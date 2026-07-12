export interface RetryOptions {
  /** Quantas vezes tentar de novo depois da 1ª tentativa (2 retries = 3 tentativas no total). */
  retries: number;
  /** Backoff exponencial: tentativa N espera `baseDelayMs * 2^(N-1)`. */
  baseDelayMs: number;
  /** Injetável nos testes; default é um `setTimeout` real. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Erro transitório (rede, timeout, HTTP não-2xx via `RetryableError`) → retry com backoff;
 * depois de esgotar `retries`, relança o último erro — quem chama decide o que isso significa
 * (no runner, T10: `failed`).
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? realSleep;
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === opts.retries) break;
      await sleep(opts.baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
