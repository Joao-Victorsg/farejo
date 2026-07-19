import { createHmac } from "node:crypto";
import { E2E_BASE_URL, E2E_SERVER_ENV } from "./env";

let runIdSequence = 0;

/**
 * `getCatalogPage`/`getStoreDetail`/`getPlatformStats` (apps/web/src/lib/catalog.ts) are wrapped
 * in `unstable_cache` under the `catalog` tag with a ~1h TTL. Mutating rows directly via `pg`
 * (as this whole e2e suite does) never busts that in-memory cache on its own — Playwright's own
 * `webServer` readiness probe already issues a `GET /` before any test runs, which is enough to
 * seed a stale cache entry. Real writers (scraper runs, curation applies) invalidate through this
 * same HMAC-signed endpoint (T3/#49) instead of restarting the server; the e2e suite must too.
 */
export async function invalidateCatalog() {
  runIdSequence += 1;
  const timestamp = String(Date.now());
  const body = JSON.stringify({ platform_id: "curation", run_id: runIdSequence, timestamp: Number(timestamp) });
  const signature = createHmac("sha256", E2E_SERVER_ENV.FAREJO_CATALOG_INVALIDATION_SECRET).update(timestamp).update(body).digest("hex");

  const response = await fetch(`${E2E_BASE_URL}/api/internal/catalog-invalidation`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-proto": "https",
      "x-farejo-timestamp": timestamp,
      "x-farejo-signature": signature,
    },
    body,
  });
  if (response.status !== 204) throw new Error(`catalog invalidation failed with status ${response.status}`);
}
