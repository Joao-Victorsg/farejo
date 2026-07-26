import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertNoScrapeInFlight } from "./guard.js";

/**
 * F4/#119 (ADR-0063) — seam do guard contra o watermark inseguro: `farejo_notifier` real, contra
 * o `scrape_runs` de verdade (grant novo desta migration), nunca `service_role`.
 *
 * `assertNoScrapeInFlight` conta linhas em TODA a tabela, não por prefixo de fixture — outros
 * arquivos de teste (`runner*.test.ts`, `pipeline/scrapeRun*.test.ts`) também escrevem em
 * `scrape_runs` e rodam em paralelo contra o mesmo Postgres local. Por isso este arquivo só
 * afirma o que é robusto a esse ruído: que UMA linha própria sem `finished_at` é o bastante para
 * recusar (a contagem real pode ser maior, o teste não depende do número exato), e que a role
 * consegue ler a tabela. O caminho "sem nada em andamento" — que exigiria a tabela inteira
 * limpa, contingente ao que os outros arquivos estão fazendo no mesmo instante — vive só em
 * `guard.test.ts`, contra um pool falso.
 */
const adminUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const notifierUrl = `${adminUrl}?options=-c%20role%3Dfarejo_notifier`;
// Plataforma real e já seedada (20260711183649_seed_platforms.sql): evita criar uma fixture de
// `platforms`, que tem `base_url` obrigatório e nenhuma finalidade neste teste.
const FIXTURE_PLATFORM = "inter";

const admin = new Client({ connectionString: adminUrl });
const notifier = new Client({ connectionString: notifierUrl });

let insertedRunIds: number[] = [];

async function insertInFlightRun(): Promise<void> {
  const result = await admin.query<{ id: number }>(
    "insert into public.scrape_runs (platform_id, started_at, finished_at, status) values ($1, now(), null, 'ok') returning id",
    [FIXTURE_PLATFORM],
  );
  insertedRunIds.push(result.rows[0]!.id);
}

beforeAll(async () => {
  await admin.connect();
  await notifier.connect();
});

afterEach(async () => {
  if (insertedRunIds.length > 0) {
    await admin.query("delete from public.scrape_runs where id = any($1::bigint[])", [insertedRunIds]);
    insertedRunIds = [];
  }
});

afterAll(async () => {
  await admin.end();
  await notifier.end();
});

describe("assertNoScrapeInFlight", () => {
  it("recusa quando existe (pelo menos) um scrape_runs sem finished_at", async () => {
    await insertInFlightRun();

    await expect(assertNoScrapeInFlight(notifier)).rejects.toThrow(/scrape_runs sem finished_at/);
  });

  it("roda sob a role real farejo_notifier, que agora enxerga scrape_runs", async () => {
    await expect(notifier.query("select current_user")).resolves.toMatchObject({ rows: [{ current_user: "farejo_notifier" }] });
    await expect(notifier.query("select count(*) from public.scrape_runs")).resolves.toBeDefined();
  });
});
