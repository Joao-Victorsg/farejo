import { NotFoundError, RetryableError } from "@farejo/shared";
import { withRetry } from "./retry.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// T10: erro transitório (timeout, HTTP não-2xx exceto 404, falha de rede) → 2 retries com backoff → só
// depois disso quem chama (o runner) trata como `failed`.
const FETCH_RETRIES = 2;
const FETCH_RETRY_BASE_DELAY_MS = 500;

export interface FetchedText {
  text: string;
  finalUrl: string;
}

/** Erro HTTP retentável interno, com status estruturado para fallbacks específicos. */
export class HttpStatusError extends RetryableError {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status} em ${url}`);
    this.name = "HttpStatusError";
  }
}

/** Casca fina de fetch: 404 = desfecho terminal; falhas transitórias são retentáveis. */
export async function fetchTextResponse(url: string, extraHeaders: Record<string, string> = {}): Promise<FetchedText> {
  return withRetry(
    async () => {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": USER_AGENT,
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            ...extraHeaders,
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 404) throw new NotFoundError(`HTTP 404 em ${url}`);
        if (!res.ok) throw new HttpStatusError(res.status, url);
        return { text: await res.text(), finalUrl: res.url || url };
      } catch (error) {
        if (error instanceof RetryableError || error instanceof NotFoundError) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        throw new RetryableError(`Falha de rede em ${url}: ${reason}`);
      }
    },
    { retries: FETCH_RETRIES, baseDelayMs: FETCH_RETRY_BASE_DELAY_MS, shouldRetry: (error) => error instanceof RetryableError },
  );
}

/** Atalho para adapters que só precisam do HTML, não do URL final após redirects. */
export async function fetchText(url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  return (await fetchTextResponse(url, extraHeaders)).text;
}
