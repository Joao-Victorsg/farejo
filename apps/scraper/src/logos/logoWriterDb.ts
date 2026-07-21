import type { Pool } from "pg";
import { z } from "zod";
import { createPostgresPool } from "../postgresPool.js";

const LogoWriterEnvironment = z.object({
  FAREJO_LOGO_WRITER_DATABASE_URL: z.string().min(1),
});

let pool: Pool | undefined;

/**
 * `farejo_logo_writer` (ADR-0042): conexão dedicada do ingestor de logos, separada de
 * `service_role`/`farejo_curation` — só alcança `store_logo_sources` e as colunas
 * `stores.logo_url`/`logo_hash` (20260718060000_store_logos_storage.sql).
 */
export function getLogoWriterPool(): Pool {
  if (pool) return pool;

  const { FAREJO_LOGO_WRITER_DATABASE_URL } = LogoWriterEnvironment.parse(process.env);
  pool = createPostgresPool(FAREJO_LOGO_WRITER_DATABASE_URL, { max: 1 });
  return pool;
}
