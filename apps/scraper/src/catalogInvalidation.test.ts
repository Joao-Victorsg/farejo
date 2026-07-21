import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCatalogInvalidator } from "./catalogInvalidation.js";

const SECRET = "catalog-invalidation-test-secret-at-least-32-characters";
const ENDPOINT_URL = "https://farejo.test/api/internal/catalog-invalidation";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createCatalogInvalidator", () => {
  it("signs the exact timestamp and body sent to the catalog endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const timestamp = new Date("2026-07-21T02:00:00.000Z");
    await createCatalogInvalidator({
      CATALOG_INVALIDATION_URL: ENDPOINT_URL,
      CATALOG_INVALIDATION_SECRET: SECRET,
    })({ platformId: "zoom", runId: 112, timestamp });

    const timestampHeader = String(timestamp.getTime());
    const body = JSON.stringify({ platform_id: "zoom", run_id: 112, timestamp: timestamp.getTime() });
    const signature = createHmac("sha256", SECRET).update(timestampHeader).update(body).digest("hex");

    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT_URL, expect.objectContaining({
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-farejo-timestamp": timestampHeader,
        "x-farejo-signature": signature,
      },
    }));
  });

  it("reports which configuration keys are invalid without logging their values", async () => {
    const invalidate = createCatalogInvalidator({
      CATALOG_INVALIDATION_URL: "not-a-production-url",
      CATALOG_INVALIDATION_SECRET: "short",
    });

    await expect(invalidate({ platformId: "zoom", runId: 112, timestamp: new Date() }))
      .rejects.toThrow("Catalog invalidation is not configured: CATALOG_INVALIDATION_URL, CATALOG_INVALIDATION_SECRET");
  });

  it("preserves the endpoint status in the operational error", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })));
    const invalidate = createCatalogInvalidator({
      CATALOG_INVALIDATION_URL: ENDPOINT_URL,
      CATALOG_INVALIDATION_SECRET: SECRET,
    });

    await expect(invalidate({ platformId: "zoom", runId: 112, timestamp: new Date() }))
      .rejects.toThrow("Catalog invalidation returned HTTP 401");
  });
});
