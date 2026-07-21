import "dotenv/config";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createPostgresPool } from "../postgresPool.js";

/**
 * Medição da meta de 95% (F3/T16/#62, ADR-0043/ADR-0054). Roda com uma credencial própria
 * (`farejo_logo_coverage`), que só enxerga a view agregada `web_read.logo_coverage` — nunca
 * uma linha de oferta, nunca as credenciais de escrita de logo (`farejo_logo_writer`).
 */

const CoverageEnvironment = z.object({
  FAREJO_LOGO_COVERAGE_DATABASE_URL: z.string().min(1),
});

export const LOGO_COVERAGE_TARGET = 0.95;

export interface LogoCoverageReport {
  eligibleStores: number;
  storesWithLogo: number;
  /** 0..1. Sem lojas elegíveis não há meta a descumprir — conta como 1 (não como 0). */
  coverage: number;
  meetsTarget: boolean;
}

export interface CoveragePool {
  query<T = unknown>(text: string): Promise<{ rows: T[] }>;
}

export async function computeLogoCoverage(pool: CoveragePool): Promise<LogoCoverageReport> {
  const { rows } = await pool.query<{ eligible_stores: number; stores_with_logo: number }>(
    "select eligible_stores, stores_with_logo from web_read.logo_coverage",
  );
  const row = rows[0] ?? { eligible_stores: 0, stores_with_logo: 0 };
  const coverage = row.eligible_stores === 0 ? 1 : row.stores_with_logo / row.eligible_stores;

  return {
    eligibleStores: row.eligible_stores,
    storesWithLogo: row.stores_with_logo,
    coverage,
    meetsTarget: coverage >= LOGO_COVERAGE_TARGET,
  };
}

export function formatLogoCoverageReport(report: LogoCoverageReport): string {
  const percent = (report.coverage * 100).toFixed(1);
  const marker = report.meetsTarget ? "✅" : "⚠️";
  return `${marker} [logo-coverage] ${report.storesWithLogo}/${report.eligibleStores} lojas elegíveis com logo final (${percent}%, meta ADR-0043 >= 95%)`;
}

async function main(): Promise<void> {
  const environment = CoverageEnvironment.safeParse(process.env);
  if (!environment.success) {
    // Mesmo padrão do resumo do Telegram (summary.ts): credencial pendente de configuração
    // operacional é um aviso, nunca falha o job de ingestão de logos.
    console.warn("[logo-coverage] FAREJO_LOGO_COVERAGE_DATABASE_URL ausente; verificação de cobertura pulada");
    return;
  }

  const pool = createPostgresPool(environment.data.FAREJO_LOGO_COVERAGE_DATABASE_URL, { max: 1 });
  try {
    const report = await computeLogoCoverage(pool);
    console.log(formatLogoCoverageReport(report));
  } finally {
    await pool.end();
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
