import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createPostgresPool } from "@farejo/postgres";

/**
 * F3/T18 (#64, ADR-0041): gate de publicação. Roda com a mesma credencial privilegiada usada
 * para aplicar as migrations aditivas, logo depois delas e antes de qualquer deploy na Vercel.
 * Confirma que o estado materializado no Postgres de produção bate com o que as migrations já
 * mescladas declaram — roles, views, funções, RLS, uma amostra de alto risco dos GRANTs e o
 * bucket de logos — em vez de assumir que `supabase db push` sem erro implica automaticamente
 * nisso (drift manual, migration parcial ou papel criado fora do fluxo não teriam outro sinal).
 *
 * Mora em `packages/db-audit`, não em `apps/web`, porque o contrato que ele audita é do banco e
 * já vive na raiz do monorepo (`supabase/migrations/`) — a verificação pertence ao mesmo nível
 * da coisa verificada. O endereço anterior (`apps/web/test/`) era resíduo de onde `pg` e a
 * credencial já estavam: o app web nunca usou `farejo_curation`, `farejo_logo_writer` nem
 * `farejo_logo_coverage`, que pertencem ao `curation-apply.yml` e ao `logos.yml`.
 */

const DeployEnvironment = z.object({
  FAREJO_DEPLOY_DATABASE_URL: z.string().min(1),
});

export interface SchemaCheckPool {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export const EXPECTED_LOGIN_ROLES = [
  "farejo_web",
  "farejo_activation",
  "farejo_metrics",
  "farejo_curation",
  "farejo_logo_writer",
  "farejo_logo_coverage",
  "farejo_bot",
  "farejo_notifier",
] as const;

export const EXPECTED_WEB_READ_VIEWS = [
  "catalog_offers",
  "catalog_stores",
  "catalog_search_terms",
  "store_details",
  "store_redirects",
  "logo_coverage",
] as const;

export const EXPECTED_FUNCTIONS = [
  { schema: "public", name: "pipeline_write_offers" },
  { schema: "web_read", name: "catalog_search" },
  { schema: "web_read", name: "store_history" },
  { schema: "web_read", name: "catalog_history" },
  { schema: "web_read", name: "platform_stats" },
  { schema: "activation", name: "resolve_destination" },
  { schema: "activation", name: "record_activation" },
  { schema: "curation", name: "apply_alias_merge" },
  { schema: "curation", name: "verify_alias_merge" },
  { schema: "alerts", name: "pending_avisos" },
] as const;

export const EXPECTED_RLS_TABLES = [
  "platforms",
  "stores",
  "store_aliases",
  "offers",
  "offer_history",
  "scrape_runs",
  "crawl_state",
  "activation_metrics",
  "store_logo_sources",
  "store_slug_redirects",
  "subscribers",
  "subscriptions",
] as const;

export const LOGO_BUCKET_ID = "store-logos";
const LOGO_BUCKET_MAX_BYTES = 2097152;
const LOGO_BUCKET_MIME_TYPE = "image/webp";

// Amostra de alto risco dos GRANTs declarados nas migrations mescladas — não o inventário
// completo (existência de role/view/função/RLS já cobre a maior parte do drift estrutural);
// aqui a preocupação é especificamente uma role que existe mas perdeu o privilégio que o
// produto depende dela ter, o que os checks acima não detectam sozinhos.
export const EXPECTED_TABLE_GRANTS = [
  { role: "farejo_web", relation: "web_read.catalog_offers", privilege: "SELECT" },
  { role: "farejo_web", relation: "web_read.catalog_stores", privilege: "SELECT" },
  { role: "farejo_web", relation: "web_read.store_details", privilege: "SELECT" },
  { role: "farejo_web", relation: "web_read.store_redirects", privilege: "SELECT" },
  { role: "farejo_logo_writer", relation: "public.store_logo_sources", privilege: "SELECT" },
  { role: "farejo_logo_writer", relation: "public.store_logo_sources", privilege: "UPDATE" },
  { role: "farejo_logo_writer", relation: "public.stores", privilege: "SELECT" },
  { role: "farejo_logo_coverage", relation: "web_read.logo_coverage", privilege: "SELECT" },
  // Avisos (#113): a entrada pública escreve Inscrição e lê o catálogo; o job lê o histórico.
  { role: "farejo_bot", relation: "public.subscriptions", privilege: "INSERT" },
  { role: "farejo_bot", relation: "public.subscriptions", privilege: "DELETE" },
  { role: "farejo_bot", relation: "public.subscribers", privilege: "INSERT" },
  { role: "farejo_bot", relation: "web_read.catalog_offers", privilege: "SELECT" },
  { role: "farejo_bot", relation: "web_read.store_redirects", privilege: "SELECT" },
  { role: "farejo_notifier", relation: "public.subscriptions", privilege: "SELECT" },
  { role: "farejo_notifier", relation: "public.offer_history", privilege: "SELECT" },
  { role: "farejo_notifier", relation: "public.subscribers", privilege: "DELETE" },
] as const;

export const EXPECTED_FUNCTION_GRANTS = [
  { role: "farejo_web", signature: "web_read.catalog_search(text, text, integer)" },
  { role: "farejo_web", signature: "web_read.store_history(text)" },
  { role: "farejo_web", signature: "web_read.catalog_history(text[])" },
  { role: "farejo_web", signature: "web_read.platform_stats(text[])" },
  { role: "farejo_activation", signature: "activation.resolve_destination(text, text)" },
  { role: "farejo_metrics", signature: "activation.record_activation(bigint, text)" },
  { role: "farejo_curation", signature: "curation.apply_alias_merge(text, jsonb)" },
  { role: "farejo_curation", signature: "curation.verify_alias_merge(text, jsonb)" },
  { role: "farejo_notifier", signature: "alerts.pending_avisos(bigint)" },
] as const;

export const EXPECTED_COLUMN_GRANTS = [
  { role: "farejo_logo_writer", relation: "public.stores", column: "logo_url", privilege: "UPDATE" },
  { role: "farejo_logo_writer", relation: "public.stores", column: "logo_hash", privilege: "UPDATE" },
  // A única escrita do job de Avisos é o cursor (ADR-0064) — grant por coluna, não pela tabela.
  { role: "farejo_notifier", relation: "public.subscribers", column: "last_notified_history_id", privilege: "UPDATE" },
] as const;

/**
 * Invariantes que vivem em CONSTRAINT, não em código de aplicação, e que por isso precisam ser
 * afirmados aqui: existência de role/tabela/grant não os alcança, e um `drop constraint` ou um
 * `on delete cascade` acrescentado à mão em produção passaria batido por todo o resto do gate.
 *
 * `confdeltype` é a ação ON DELETE da FK: 'a' = NO ACTION, 'c' = CASCADE.
 */
export const EXPECTED_CHECK_CONSTRAINTS = [
  // ADR-0063: acompanhamento exige Piso, melhoria o proíbe. Sem isto uma inscrição em
  // acompanhamento sem piso nunca avisaria nada, e o sintoma seria a AUSÊNCIA de mensagem.
  { relation: "public.subscriptions", name: "subscriptions_floor_matches_mode" },
] as const;

export const EXPECTED_FOREIGN_KEY_ACTIONS = [
  // ADR-0063: cascade aqui apagaria a Inscrição em silêncio num merge de alias. O NO ACTION é o
  // que obriga `curation.apply_alias_merge` a tratá-la (#115) e a falhar alto se esquecer.
  { relation: "public.subscriptions", name: "subscriptions_store_id_fkey", onDelete: "a" },
  // ...enquanto apagar o Assinante DEVE levar as Inscrições junto: /parar é DELETE de verdade
  // (ADR-0066) e as duas linhas são o mesmo agregado.
  { relation: "public.subscriptions", name: "subscriptions_subscriber_id_fkey", onDelete: "c" },
] as const;

export interface SchemaVerificationReport {
  missingRoles: string[];
  missingViews: string[];
  missingFunctions: string[];
  tablesWithoutRls: string[];
  missingRlsTables: string[];
  storageBucketOk: boolean;
  storageBucketMissing: boolean;
  missingTableGrants: string[];
  missingFunctionGrants: string[];
  missingColumnGrants: string[];
  missingCheckConstraints: string[];
  wrongForeignKeyActions: string[];
  ok: boolean;
}

function functionKey(schema: string, name: string): string {
  return `${schema}.${name}`;
}

export async function verifyProductionSchema(pool: SchemaCheckPool): Promise<SchemaVerificationReport> {
  const [roleRows, viewRows, functionRows, rlsRows, bucketRows, tableGrantRows, functionGrantRows, columnGrantRows, constraintRows] = await Promise.all([
    pool.query<{ rolname: string }>("select rolname from pg_roles where rolname = any($1)", [EXPECTED_LOGIN_ROLES]),
    pool.query<{ table_name: string }>("select table_name from information_schema.views where table_schema = 'web_read'"),
    pool.query<{ schema: string; name: string }>(
      `select n.nspname as schema, p.proname as name
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = any($1)`,
      [["public", "web_read", "activation", "curation", "alerts"]],
    ),
    pool.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1)`,
      [EXPECTED_RLS_TABLES],
    ),
    pool.query<{ public: boolean; file_size_limit: string | number | null; allowed_mime_types: string[] | null }>(
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1",
      [LOGO_BUCKET_ID],
    ),
    // has_table_privilege() resolve privilégio efetivo (inclusive por herança de role), o
    // jeito idiomático do Postgres de responder "essa role consegue mesmo fazer X" — mais
    // confiável que juntar information_schema.role_table_grants manualmente.
    pool.query<{ role: string; relation: string; privilege: string; granted: boolean }>(
      `select g.role, g.relation, g.privilege, has_table_privilege(g.role, g.relation, g.privilege) as granted
       from unnest($1::text[], $2::text[], $3::text[]) as g(role, relation, privilege)`,
      [EXPECTED_TABLE_GRANTS.map((g) => g.role), EXPECTED_TABLE_GRANTS.map((g) => g.relation), EXPECTED_TABLE_GRANTS.map((g) => g.privilege)],
    ),
    pool.query<{ role: string; signature: string; granted: boolean }>(
      `select g.role, g.signature, has_function_privilege(g.role, g.signature::regprocedure, 'EXECUTE') as granted
       from unnest($1::text[], $2::text[]) as g(role, signature)`,
      [EXPECTED_FUNCTION_GRANTS.map((g) => g.role), EXPECTED_FUNCTION_GRANTS.map((g) => g.signature)],
    ),
    pool.query<{ role: string; relation: string; column: string; privilege: string; granted: boolean }>(
      `select g.role, g.relation, g.column, g.privilege, has_column_privilege(g.role, g.relation, g.column, g.privilege) as granted
       from unnest($1::text[], $2::text[], $3::text[], $4::text[]) as g(role, relation, "column", privilege)`,
      [
        EXPECTED_COLUMN_GRANTS.map((g) => g.role),
        EXPECTED_COLUMN_GRANTS.map((g) => g.relation),
        EXPECTED_COLUMN_GRANTS.map((g) => g.column),
        EXPECTED_COLUMN_GRANTS.map((g) => g.privilege),
      ],
    ),
    pool.query<{ relation: string; name: string; contype: string; confdeltype: string | null }>(
      // O nome qualificado é montado de pg_namespace/pg_class em vez de `conrelid::regclass::text`
      // porque o regclass OMITE o schema quando ele está no search_path da conexão — a comparação
      // por igualdade passaria a depender de quem chama.
      `select n.nspname || '.' || c.relname as relation, con.conname as name,
              con.contype::text as contype, nullif(con.confdeltype::text, '') as confdeltype
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname || '.' || c.relname = any($1)`,
      [[...new Set([...EXPECTED_CHECK_CONSTRAINTS, ...EXPECTED_FOREIGN_KEY_ACTIONS].map((c) => c.relation))]],
    ),
  ]);

  const foundRoles = new Set(roleRows.rows.map((row) => row.rolname));
  const missingRoles = EXPECTED_LOGIN_ROLES.filter((role) => !foundRoles.has(role));

  const foundViews = new Set(viewRows.rows.map((row) => row.table_name));
  const missingViews = EXPECTED_WEB_READ_VIEWS.filter((view) => !foundViews.has(view));

  const foundFunctions = new Set(functionRows.rows.map((row) => functionKey(row.schema, row.name)));
  const missingFunctions = EXPECTED_FUNCTIONS.filter((fn) => !foundFunctions.has(functionKey(fn.schema, fn.name))).map((fn) =>
    functionKey(fn.schema, fn.name),
  );

  const rlsByTable = new Map(rlsRows.rows.map((row) => [row.relname, row.relrowsecurity]));
  const missingRlsTables = EXPECTED_RLS_TABLES.filter((table) => !rlsByTable.has(table));
  const tablesWithoutRls = EXPECTED_RLS_TABLES.filter((table) => rlsByTable.has(table) && !rlsByTable.get(table));

  const bucket = bucketRows.rows[0];
  const storageBucketMissing = !bucket;
  // node-postgres devolve `bigint` (o tipo de storage.buckets.file_size_limit) como string, não
  // number, para não perder precisão acima de 2^53 — comparar direto com `===` contra um
  // literal number falharia sempre, mesmo com o valor certo no banco.
  const storageBucketOk = Boolean(
    bucket &&
      bucket.public === true &&
      Number(bucket.file_size_limit) === LOGO_BUCKET_MAX_BYTES &&
      Array.isArray(bucket.allowed_mime_types) &&
      bucket.allowed_mime_types.length === 1 &&
      bucket.allowed_mime_types[0] === LOGO_BUCKET_MIME_TYPE,
  );

  const missingTableGrants = tableGrantRows.rows.filter((row) => !row.granted).map((row) => `${row.role}→${row.relation}(${row.privilege})`);
  const missingFunctionGrants = functionGrantRows.rows.filter((row) => !row.granted).map((row) => `${row.role}→${row.signature}`);
  const missingColumnGrants = columnGrantRows.rows.filter((row) => !row.granted).map((row) => `${row.role}→${row.relation}.${row.column}(${row.privilege})`);

  const constraintsByKey = new Map(constraintRows.rows.map((row) => [`${row.relation}|${row.name}`, row]));

  const missingCheckConstraints = EXPECTED_CHECK_CONSTRAINTS.filter((expected) => {
    const found = constraintsByKey.get(`${expected.relation}|${expected.name}`);
    return !found || found.contype !== "c";
  }).map((expected) => `${expected.relation}.${expected.name}`);

  const wrongForeignKeyActions = EXPECTED_FOREIGN_KEY_ACTIONS.flatMap((expected) => {
    const found = constraintsByKey.get(`${expected.relation}|${expected.name}`);
    if (!found || found.contype !== "f") return [`${expected.relation}.${expected.name} (ausente)`];
    if (found.confdeltype !== expected.onDelete) {
      return [`${expected.relation}.${expected.name} (on delete "${found.confdeltype}", esperado "${expected.onDelete}")`];
    }
    return [];
  });

  const ok =
    missingCheckConstraints.length === 0 &&
    wrongForeignKeyActions.length === 0 &&
    missingRoles.length === 0 &&
    missingViews.length === 0 &&
    missingFunctions.length === 0 &&
    missingRlsTables.length === 0 &&
    tablesWithoutRls.length === 0 &&
    storageBucketOk &&
    missingTableGrants.length === 0 &&
    missingFunctionGrants.length === 0 &&
    missingColumnGrants.length === 0;

  return {
    missingRoles,
    missingViews,
    missingFunctions,
    tablesWithoutRls,
    missingRlsTables,
    storageBucketOk,
    storageBucketMissing,
    missingTableGrants,
    missingFunctionGrants,
    missingColumnGrants,
    missingCheckConstraints,
    wrongForeignKeyActions,
    ok,
  };
}

export function formatSchemaVerificationReport(report: SchemaVerificationReport): string {
  if (report.ok) return "✅ [verify-schema] roles, views, funções, RLS, constraints e bucket de logos batem com as migrations mescladas";

  const lines = ["❌ [verify-schema] drift detectado entre o banco de produção e as migrations mescladas:"];
  if (report.missingRoles.length) lines.push(`  - roles ausentes: ${report.missingRoles.join(", ")}`);
  if (report.missingViews.length) lines.push(`  - views ausentes em web_read: ${report.missingViews.join(", ")}`);
  if (report.missingFunctions.length) lines.push(`  - funções ausentes: ${report.missingFunctions.join(", ")}`);
  if (report.missingRlsTables.length) lines.push(`  - tabelas ausentes: ${report.missingRlsTables.join(", ")}`);
  if (report.tablesWithoutRls.length) lines.push(`  - tabelas sem RLS habilitado: ${report.tablesWithoutRls.join(", ")}`);
  if (report.storageBucketMissing) lines.push(`  - bucket "${LOGO_BUCKET_ID}" não existe`);
  else if (!report.storageBucketOk) lines.push(`  - bucket "${LOGO_BUCKET_ID}" existe mas não bate com a config esperada (público, ${LOGO_BUCKET_MAX_BYTES} bytes, ${LOGO_BUCKET_MIME_TYPE})`);
  if (report.missingTableGrants.length) lines.push(`  - grants de tabela/view ausentes: ${report.missingTableGrants.join(", ")}`);
  if (report.missingFunctionGrants.length) lines.push(`  - grants de execução ausentes: ${report.missingFunctionGrants.join(", ")}`);
  if (report.missingColumnGrants.length) lines.push(`  - grants de coluna ausentes: ${report.missingColumnGrants.join(", ")}`);
  if (report.missingCheckConstraints.length) lines.push(`  - check constraints ausentes: ${report.missingCheckConstraints.join(", ")}`);
  if (report.wrongForeignKeyActions.length) lines.push(`  - chaves estrangeiras com ON DELETE fora do contrato: ${report.wrongForeignKeyActions.join(", ")}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const environment = DeployEnvironment.safeParse(process.env);
  if (!environment.success) {
    console.error("[verify-schema] FAREJO_DEPLOY_DATABASE_URL ausente; não é possível verificar o schema de produção");
    process.exitCode = 1;
    return;
  }

  // max: 5, não 1 — verifyProductionSchema dispara 5 queries de leitura em paralelo
  // (Promise.all); um pool de conexão única as serializaria sem avisar, disfarçando o custo
  // real deste passo do deploy.
  const pool = createPostgresPool(environment.data.FAREJO_DEPLOY_DATABASE_URL, { max: 5 });
  try {
    const report = await verifyProductionSchema(pool);
    console.log(formatSchemaVerificationReport(report));
    if (!report.ok) process.exitCode = 1;
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
