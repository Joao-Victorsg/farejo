import { RetryableError } from "@farejo/shared";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Casca fina de fetch comum aos adapters: UA de browser real, timeout, HTTP não-2xx = RetryableError. */
export async function fetchText(url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
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
}
