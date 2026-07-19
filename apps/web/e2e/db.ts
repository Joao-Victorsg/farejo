import { Client } from "pg";
import { E2E_DATABASE_URL } from "./env";

/** Distinct prefix from test/smoke.mts and the vitest *-db.test.ts fixtures — no collisions. */
export const FIXTURE_PREFIX = "f3t17-e2e-";

export function fixtureSlug(name: string) {
  return `${FIXTURE_PREFIX}${name}`;
}

export async function withDb<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * O catálogo anômalo-vazio (T17) precisa de zero lojas de verdade, não só ausência dos fixtures
 * deste pacote. `apps/scraper`'s runner *.test.ts usa fixtures reais (Samsung, iPlace, ...) sem
 * limpar depois — por design, dependem de `supabase db reset` entre suites, não de cleanup por
 * teste. `vitest run` roda antes deste pacote na cadeia `pnpm test`, então o catálogo real nunca
 * está garantidamente vazio neste ponto. Truncar aqui é seguro: o Supabase local do CI é efêmero
 * por job, e localmente é o mesmo banco de desenvolvimento que já se assume descartável via
 * `pnpm db:reset` (script do próprio monorepo).
 */
export async function truncateCatalog(client: Client) {
  await client.query("truncate table public.stores restart identity cascade");
}

export async function cleanFixtures(client: Client) {
  await client.query("delete from public.store_aliases where store_id in (select id from public.stores where slug like $1)", [`${FIXTURE_PREFIX}%`]);
  await client.query("delete from public.activation_metrics where store_id in (select id from public.stores where slug like $1)", [`${FIXTURE_PREFIX}%`]);
  await client.query("delete from public.offer_history where store_id in (select id from public.stores where slug like $1)", [`${FIXTURE_PREFIX}%`]);
  await client.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${FIXTURE_PREFIX}%`]);
  await client.query("delete from public.stores where slug like $1", [`${FIXTURE_PREFIX}%`]);
}
