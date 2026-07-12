import { RetryableError } from "@farejo/shared";
import { withRetry } from "./retry.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// T10: erro transitório (timeout, HTTP não-2xx, falha de rede) → 2 retries com backoff → só
// depois disso quem chama (o runner) trata como `failed`.
const FETCH_RETRIES = 2;
const FETCH_RETRY_BASE_DELAY_MS = 500;

/** Casca fina de fetch comum aos adapters: UA de browser real, timeout, HTTP não-2xx = RetryableError, com retry. */
export async function fetchText(url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  return withRetry(
    async () => {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
          ...extraHeaders,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new RetryableError(`HTTP ${res.status} em ${url}`);
      return res.text();
    },
    { retries: FETCH_RETRIES, baseDelayMs: FETCH_RETRY_BASE_DELAY_MS },
  );
}
