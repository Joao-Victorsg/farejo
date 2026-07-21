import { createHmac } from "node:crypto";
import { z } from "zod";

const InvalidationEnvironment = z.object({
  CATALOG_INVALIDATION_URL: z.string().url().refine((url) => {
    try {
      return new URL(url).protocol === "https:";
    } catch {
      return false;
    }
  }),
  CATALOG_INVALIDATION_SECRET: z.string().min(32),
});

export type CatalogInvalidationEvent = {
  platformId: string;
  runId: number;
  timestamp: Date;
};

export type CatalogInvalidator = (event: CatalogInvalidationEvent) => Promise<void>;

export function createCatalogInvalidator(environment: Record<string, string | undefined> = process.env): CatalogInvalidator {
  return async (event) => {
    const configuration = InvalidationEnvironment.safeParse(environment);
    if (!configuration.success) {
      const invalidKeys = [...new Set(configuration.error.issues.flatMap((issue) => {
        const key = issue.path[0];
        return typeof key === "string" ? [key] : [];
      }))];
      throw new Error(`Catalog invalidation is not configured: ${invalidKeys.join(", ")}`);
    }

    const timestamp = String(event.timestamp.getTime());
    const body = JSON.stringify({
      platform_id: event.platformId,
      run_id: event.runId,
      timestamp: Number(timestamp),
    });
    const signature = createHmac("sha256", configuration.data.CATALOG_INVALIDATION_SECRET)
      .update(timestamp)
      .update(body)
      .digest("hex");
    const response = await fetch(configuration.data.CATALOG_INVALIDATION_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-farejo-timestamp": timestamp,
        "x-farejo-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Catalog invalidation returned HTTP ${response.status}`);
  };
}
