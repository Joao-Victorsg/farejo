import "server-only";
import type { Pool } from "pg";
import { z } from "zod";
import { createPostgresPool } from "./postgres-pool";

const ActivationDestinationRow = z.object({
  store_id: z.coerce.number().int().positive(),
  destination: z.string().url().refine((value) => new URL(value).protocol === "https:"),
});

let activationPool: Pool | undefined;
let metricsPool: Pool | undefined;

function getPool(environmentName: "FAREJO_ACTIVATION_DATABASE_URL" | "FAREJO_METRICS_DATABASE_URL", currentPool: Pool | undefined) {
  if (currentPool) return currentPool;

  const connectionString = z.string().url().parse(process.env[environmentName]);

  return createPostgresPool(connectionString, {
    max: 1,
    connectionTimeoutMillis: 1_500,
    query_timeout: 1_500,
  });
}

function getActivationPool() {
  activationPool ??= getPool("FAREJO_ACTIVATION_DATABASE_URL", activationPool);
  return activationPool;
}

function getMetricsPool() {
  metricsPool ??= getPool("FAREJO_METRICS_DATABASE_URL", metricsPool);
  return metricsPool;
}

export type ActivationResolution =
  | { kind: "available"; storeId: number; destination: string }
  | { kind: "unavailable" };

export async function resolveActivation(storeSlug: string, platformId: string): Promise<ActivationResolution> {
  const result = await getActivationPool().query(
    "select store_id, destination from activation.resolve_destination($1, $2)",
    [storeSlug, platformId],
  );
  const row = ActivationDestinationRow.nullable().parse(result.rows[0] ?? null);

  return row ? { kind: "available", storeId: row.store_id, destination: row.destination } : { kind: "unavailable" };
}

export async function recordActivation(storeId: number, platformId: string) {
  await getMetricsPool().query("select activation.record_activation($1, $2)", [storeId, platformId]);
}
