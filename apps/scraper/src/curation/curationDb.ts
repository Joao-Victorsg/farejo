import { Pool } from "pg";

let pool: Pool | undefined;

/**
 * `curation` não está exposto no PostgREST (supabase/config.toml) — como web_read/activation,
 * só é alcançável por conexão pg direta com a role dedicada, nunca via supabaseClient.ts
 * (service_role/PostgREST) que o resto do scraper usa.
 */
export function getCurationPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.FAREJO_CURATION_DATABASE_URL;
  if (!connectionString) throw new Error("FAREJO_CURATION_DATABASE_URL is not configured");

  pool = new Pool({ connectionString, max: 1 });
  return pool;
}
