import "dotenv/config";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createPostgresPool } from "@farejo/postgres";

/**
 * F4/#119 (ADR-0063) — trava contra o watermark inseguro dos Avisos.
 *
 * `offer_history.id` vem de uma sequence, e `nextval` não é transacional: uma transação pode
 * reservar um id e COMMITAR DEPOIS de outra que reservou um id maior. Se o job de Avisos ler
 * `max(id)` como marca d'água nesse intervalo, o id menor nasce abaixo dela e é perdido PARA
 * SEMPRE — todos os cursores já avançaram do ponto, inclusive o de quem não recebeu nada. Não
 * existe watermark seguro enquanto houver escritor concorrente (o problema é da sequence, não da
 * consulta); a única defesa é nunca deixar o job rodar enquanto um scrape ainda está escrevendo.
 *
 * O `workflow_run` sobre o scrape concluído (`avisos.yml`) cobre o caso normal. Este guard cobre
 * o `workflow_dispatch` de recuperação, que pode se sobrepor a um scrape manual em andamento e que
 * o gatilho automático não alcança.
 */
export interface GuardPool {
  query<T = unknown>(text: string): Promise<{ rows: T[] }>;
}

export async function assertNoScrapeInFlight(pool: GuardPool): Promise<void> {
  const { rows } = await pool.query<{ count: string }>("select count(*)::text as count from public.scrape_runs where finished_at is null");
  const inFlight = Number(rows[0]?.count ?? "0");
  if (inFlight > 0) {
    throw new Error(
      `${inFlight} scrape_runs sem finished_at — um scrape ainda está em andamento. Rodar os Avisos agora arrisca perder uma Melhoria para sempre (watermark inseguro, ADR-0063). Aguarde o scrape terminar e rode de novo.`,
    );
  }
}

// Obrigatória, ao contrário de `logos:coverage`/`avisos:send` (que degradam com um aviso quando a
// credencial falta): este script É o guard de segurança, então uma credencial ausente tem de
// falhar alto, não passar batido como se estivesse tudo seguro para prosseguir.
const GuardEnvironment = z.object({
  FAREJO_NOTIFIER_DATABASE_URL: z.string().min(1),
});

async function main(): Promise<void> {
  const environment = GuardEnvironment.parse(process.env);
  const pool = createPostgresPool(environment.FAREJO_NOTIFIER_DATABASE_URL, { max: 1 });
  try {
    await assertNoScrapeInFlight(pool);
    console.log("[avisos] nenhum scrape em andamento — seguro prosseguir");
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
