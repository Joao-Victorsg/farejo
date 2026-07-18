import { Pool } from "pg";

let pool: Pool | undefined;

/**
 * `farejo_logo_writer` (ADR-0042): conexão dedicada do ingestor de logos, separada de
 * `service_role`/`farejo_curation` — só alcança `store_logo_sources` e as colunas
 * `stores.logo_url`/`logo_hash` (20260718060000_store_logos_storage.sql).
 */
export function getLogoWriterPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.FAREJO_LOGO_WRITER_DATABASE_URL;
  if (!connectionString) throw new Error("FAREJO_LOGO_WRITER_DATABASE_URL is not configured");

  pool = new Pool({ connectionString, max: 1 });
  return pool;
}
