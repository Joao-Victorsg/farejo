import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createPostgresPool } from "@farejo/postgres";

/**
 * #65 (ADR-0062): verificação NEGATIVA — confirma que os grantees mais expostos não têm nenhum
 * privilégio além do contrato. Complementa `verify-schema.ts`, que é positivo (confirma que o
 * que deve existir existe). Presença e ausência são perguntas diferentes: `has_*_privilege()`
 * responde "a role X consegue Y?" (fechada, não enumera), então nunca detecta um grant que
 * ninguém previu. Aqui a primitiva é invertida — `aclexplode()` ENUMERA o ACL real e a
 * comparação é por igualdade contra uma allowlist exata.
 *
 * Grantees cobertos: `anon`/`authenticated` (a Data API, que o farejô não usa), `farejo_web` (a role
 * do site na Vercel) e `farejo_logo_writer` (a role da Action de logos, que a ADR-0042 promete nunca
 * ver ofertas) — os do AC da #65 —, mais `farejo_bot` e `farejo_notifier` desde a #113. `PUBLIC`
 * (grantee 0) entra junto: um grant a PUBLIC atinge anon/authenticated também.
 *
 * `farejo_bot` entra por ser a superfície exposta na INTERNET, o grantee de maior risco do projeto:
 * é aqui que "o bot nunca vê o histórico de ofertas" (ADR-0064) deixa de ser texto e passa a
 * reprovar a publicação. `farejo_notifier` entra junto por nascer do mesmo contrato — e é a exceção
 * consciente à regra abaixo, porque separá-la do bot é justamente a decisão que precisa ser
 * afirmada. As demais roles operacionais (activation/metrics/curation/logo_coverage) seguem fora:
 * não são expostas ao browser e o lado positivo já as cobre.
 *
 * Depende do hardening da migration 20260724000000: sem ele, anon/authenticated carregam o baseline
 * default do Supabase em public e esta verificação falha de propósito (era o ponto — torná-lo
 * visível). Roda no deploy logo após `verify:schema`, com a mesma credencial.
 */

const DeployEnvironment = z.object({
  FAREJO_DEPLOY_DATABASE_URL: z.string().min(1),
});

export interface PrivilegeCheckPool {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

// Grantees cujo ACL é auditado por igualdade. `PUBLIC` é enumerado como o literal "PUBLIC"
// (aclexplode devolve grantee 0 para o pseudo-role) e nunca deve ter grant nos schemas do produto.
export const AUDITED_GRANTEES = [
  "anon",
  "authenticated",
  "farejo_web",
  "farejo_logo_writer",
  // Avisos (#113, ADR-0064). `farejo_bot` entra por ser a superfície exposta na internet — é o
  // grantee de maior risco do projeto, e é aqui que "o bot nunca vê o histórico de ofertas" deixa
  // de ser texto de ADR. `farejo_notifier` entra junto porque as duas nascem do mesmo contrato.
  "farejo_bot",
  "farejo_notifier",
] as const;
export const PRODUCT_SCHEMAS = ["public", "web_read", "activation", "curation", "alerts"] as const;
// storage entra só para policies: a única policy que pode referenciar PUBLIC é a de leitura de logos.
export const POLICY_SCHEMAS = [...PRODUCT_SCHEMAS, "storage"] as const;

// Contrato positivo EXATO. Qualquer par real fora destes conjuntos é excesso. anon, authenticated e
// PUBLIC não aparecem: o contrato deles é o conjunto vazio.
export const ALLOWED_TABLE_GRANTS = new Set([
  "farejo_web|web_read.catalog_offers|SELECT",
  "farejo_web|web_read.catalog_stores|SELECT",
  "farejo_web|web_read.store_details|SELECT",
  "farejo_web|web_read.store_redirects|SELECT",
  "farejo_logo_writer|public.store_logo_sources|SELECT",
  "farejo_logo_writer|public.store_logo_sources|UPDATE",
  "farejo_logo_writer|public.stores|SELECT",
  // farejo_bot: escreve Inscrições e resolve slug; lê oferta corrente só pelas views do catálogo.
  // A ausência de `public.offers` e `public.offer_history` nesta lista é o contrato.
  "farejo_bot|public.subscribers|SELECT",
  "farejo_bot|public.subscribers|INSERT",
  "farejo_bot|public.subscribers|DELETE",
  "farejo_bot|public.subscriptions|SELECT",
  "farejo_bot|public.subscriptions|INSERT",
  "farejo_bot|public.subscriptions|UPDATE",
  "farejo_bot|public.subscriptions|DELETE",
  "farejo_bot|public.stores|SELECT",
  "farejo_bot|web_read.store_redirects|SELECT",
  "farejo_bot|web_read.catalog_offers|SELECT",
  // farejo_notifier: lê o que o Aviso precisa. A única escrita é o cursor, e ela é por coluna
  // (ALLOWED_COLUMN_GRANTS) — nenhum UPDATE de tabela inteira aparece aqui.
  "farejo_notifier|public.subscribers|SELECT",
  "farejo_notifier|public.subscribers|DELETE",
  "farejo_notifier|public.subscriptions|SELECT",
  "farejo_notifier|public.offer_history|SELECT",
  "farejo_notifier|public.offers|SELECT",
  "farejo_notifier|public.stores|SELECT",
  "farejo_notifier|public.platforms|SELECT",
]);

export const ALLOWED_COLUMN_GRANTS = new Set([
  "farejo_logo_writer|public.stores.logo_url|UPDATE",
  "farejo_logo_writer|public.stores.logo_hash|UPDATE",
  "farejo_notifier|public.subscribers.last_notified_history_id|UPDATE",
]);

export const ALLOWED_FUNCTION_GRANTS = new Set([
  "farejo_web|web_read.catalog_search|EXECUTE",
  "farejo_web|web_read.store_history|EXECUTE",
  "farejo_web|web_read.catalog_history|EXECUTE",
  "farejo_web|web_read.platform_stats|EXECUTE",
  // Funções nascem com EXECUTE para PUBLIC; a migration revoga, e é este conjunto exato que
  // garante que continue revogado.
  "farejo_notifier|alerts.pending_avisos|EXECUTE",
]);

export const ALLOWED_SCHEMA_GRANTS = new Set([
  "farejo_web|web_read|USAGE",
  "farejo_logo_writer|public|USAGE",
  "farejo_bot|public|USAGE",
  "farejo_bot|web_read|USAGE",
  "farejo_notifier|public|USAGE",
  "farejo_notifier|alerts|USAGE",
]);

// A única policy do produto que pode referenciar PUBLIC/anon/authenticated: leitura pública de
// logos em storage.objects (ADR-0038). Chave: schema.tabela|policyname|cmd.
export const ALLOWED_PERMISSIVE_POLICIES = new Set([
  "storage.objects|store_logos_select_objects|SELECT",
]);

export interface PrivilegeVerificationReport {
  unexpectedTableGrants: string[];
  unexpectedColumnGrants: string[];
  unexpectedFunctionGrants: string[];
  unexpectedSchemaGrants: string[];
  unexpectedMemberships: string[];
  unexpectedRoleAttributes: string[];
  unexpectedPolicies: string[];
  ok: boolean;
}

interface GrantRow {
  grantee: string;
  schema: string;
  object: string;
  privilege: string;
}
interface ColumnGrantRow extends GrantRow {
  column: string;
}
interface RoleAttrRow {
  rolname: string;
  rolsuper: boolean;
  rolinherit: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolcanlogin: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
}
interface MembershipRow {
  member: string;
  role_of: string;
}
interface PolicyRow {
  schemaname: string;
  tablename: string;
  policyname: string;
  cmd: string;
  roles: string;
}

// Roles que DEVEM poder logar (as outras auditadas devem ser NOLOGIN).
const LOGIN_ROLES = new Set(["farejo_web", "farejo_logo_writer", "farejo_bot", "farejo_notifier"]);
// Roles criadas pelo farejô com `noinherit` por contrato. anon/authenticated são da plataforma
// Supabase e carregam o default INHERIT do Postgres — inócuo, porque não são membros de nenhuma
// role (o check de membership abaixo garante que continue assim), então INHERIT só é auditado aqui.
const NOINHERIT_ROLES = new Set(["farejo_web", "farejo_logo_writer", "farejo_bot", "farejo_notifier"]);

export async function verifyProductionPrivileges(pool: PrivilegeCheckPool): Promise<PrivilegeVerificationReport> {
  const grantees = [...AUDITED_GRANTEES];
  const schemas = [...PRODUCT_SCHEMAS];

  const [tableRows, columnRows, functionRows, schemaRows, roleRows, membershipRows, policyRows] = await Promise.all([
    pool.query<GrantRow>(
      `select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
              n.nspname as schema, c.relname as object, a.privilege_type as privilege
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join lateral aclexplode(c.relacl) a
       where n.nspname = any($1)
         and (a.grantee = 0 or a.grantee::regrole::text = any($2))`,
      [schemas, grantees],
    ),
    pool.query<ColumnGrantRow>(
      `select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
              n.nspname as schema, c.relname as object, att.attname as column, a.privilege_type as privilege
       from pg_attribute att
       join pg_class c on c.oid = att.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       cross join lateral aclexplode(att.attacl) a
       where n.nspname = any($1) and att.attnum > 0 and not att.attisdropped
         and (a.grantee = 0 or a.grantee::regrole::text = any($2))`,
      [schemas, grantees],
    ),
    pool.query<GrantRow>(
      `select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
              n.nspname as schema, p.proname as object, a.privilege_type as privilege
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(p.proacl) a
       where n.nspname = any($1)
         and (a.grantee = 0 or a.grantee::regrole::text = any($2))`,
      [schemas, grantees],
    ),
    pool.query<Omit<GrantRow, "object">>(
      `select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
              n.nspname as schema, a.privilege_type as privilege
       from pg_namespace n
       cross join lateral aclexplode(n.nspacl) a
       where n.nspname = any($1)
         and (a.grantee = 0 or a.grantee::regrole::text = any($2))`,
      [schemas, grantees],
    ),
    pool.query<RoleAttrRow>(
      `select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls
       from pg_roles where rolname = any($1)`,
      [grantees],
    ),
    pool.query<MembershipRow>(
      `select m.member::regrole::text as member, m.roleid::regrole::text as role_of
       from pg_auth_members m
       where m.member::regrole::text = any($1)`,
      [grantees],
    ),
    pool.query<PolicyRow>(
      `select schemaname, tablename, policyname, cmd, roles::text as roles
       from pg_policies
       where schemaname = any($1)
         and (roles && array['anon','authenticated']::name[] or roles = array['public']::name[])`,
      [[...POLICY_SCHEMAS]],
    ),
  ]);

  const unexpectedTableGrants = tableRows.rows
    .map((r) => `${r.grantee}|${r.schema}.${r.object}|${r.privilege}`)
    .filter((key) => !ALLOWED_TABLE_GRANTS.has(key))
    .sort();

  const unexpectedColumnGrants = columnRows.rows
    .map((r) => `${r.grantee}|${r.schema}.${r.object}.${r.column}|${r.privilege}`)
    .filter((key) => !ALLOWED_COLUMN_GRANTS.has(key))
    .sort();

  const unexpectedFunctionGrants = functionRows.rows
    .map((r) => `${r.grantee}|${r.schema}.${r.object}|${r.privilege}`)
    .filter((key) => !ALLOWED_FUNCTION_GRANTS.has(key))
    .sort();

  const unexpectedSchemaGrants = schemaRows.rows
    .map((r) => `${r.grantee}|${r.schema}|${r.privilege}`)
    .filter((key) => !ALLOWED_SCHEMA_GRANTS.has(key))
    .sort();

  // Qualquer membership é excesso: nenhum grantee auditado herda de outra role no contrato.
  const unexpectedMemberships = membershipRows.rows.map((r) => `${r.member}→${r.role_of}`).sort();

  const unexpectedRoleAttributes: string[] = [];
  for (const role of roleRows.rows) {
    const flags: string[] = [];
    if (role.rolsuper) flags.push("SUPERUSER");
    if (role.rolbypassrls) flags.push("BYPASSRLS");
    if (role.rolcreaterole) flags.push("CREATEROLE");
    if (role.rolcreatedb) flags.push("CREATEDB");
    if (role.rolreplication) flags.push("REPLICATION");
    // noinherit é o contrato das roles do farejô; herança ligada abriria escalação lateral se a
    // role virasse membro de outra. anon/authenticated ficam de fora (default da plataforma).
    if (role.rolinherit && NOINHERIT_ROLES.has(role.rolname)) flags.push("INHERIT");
    // anon/authenticated devem ser NOLOGIN; as roles do farejô devem ser LOGIN.
    const shouldLogin = LOGIN_ROLES.has(role.rolname);
    if (role.rolcanlogin && !shouldLogin) flags.push("LOGIN");
    if (!role.rolcanlogin && shouldLogin) flags.push("NOLOGIN");
    if (flags.length) unexpectedRoleAttributes.push(`${role.rolname}:${flags.join(",")}`);
  }
  unexpectedRoleAttributes.sort();

  const unexpectedPolicies = policyRows.rows
    .map((r) => `${r.schemaname}.${r.tablename}|${r.policyname}|${r.cmd}`)
    .filter((key) => !ALLOWED_PERMISSIVE_POLICIES.has(key))
    .sort();

  const ok =
    unexpectedTableGrants.length === 0 &&
    unexpectedColumnGrants.length === 0 &&
    unexpectedFunctionGrants.length === 0 &&
    unexpectedSchemaGrants.length === 0 &&
    unexpectedMemberships.length === 0 &&
    unexpectedRoleAttributes.length === 0 &&
    unexpectedPolicies.length === 0;

  return {
    unexpectedTableGrants,
    unexpectedColumnGrants,
    unexpectedFunctionGrants,
    unexpectedSchemaGrants,
    unexpectedMemberships,
    unexpectedRoleAttributes,
    unexpectedPolicies,
    ok,
  };
}

export function formatPrivilegeVerificationReport(report: PrivilegeVerificationReport): string {
  if (report.ok)
    return `✅ [verify-privileges] ${AUDITED_GRANTEES.join(", ")} e PUBLIC não têm privilégios além do contrato`;

  const lines = ["❌ [verify-privileges] privilégios em EXCESSO detectados (além do contrato mínimo):"];
  if (report.unexpectedTableGrants.length) lines.push(`  - grants de tabela/view: ${report.unexpectedTableGrants.join(", ")}`);
  if (report.unexpectedColumnGrants.length) lines.push(`  - grants de coluna: ${report.unexpectedColumnGrants.join(", ")}`);
  if (report.unexpectedFunctionGrants.length) lines.push(`  - grants de execução: ${report.unexpectedFunctionGrants.join(", ")}`);
  if (report.unexpectedSchemaGrants.length) lines.push(`  - grants de schema: ${report.unexpectedSchemaGrants.join(", ")}`);
  if (report.unexpectedMemberships.length) lines.push(`  - memberships (escalação por herança): ${report.unexpectedMemberships.join(", ")}`);
  if (report.unexpectedRoleAttributes.length) lines.push(`  - atributos de role: ${report.unexpectedRoleAttributes.join(", ")}`);
  if (report.unexpectedPolicies.length) lines.push(`  - policies permissivas inesperadas: ${report.unexpectedPolicies.join(", ")}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const environment = DeployEnvironment.safeParse(process.env);
  if (!environment.success) {
    console.error("[verify-privileges] FAREJO_DEPLOY_DATABASE_URL ausente; não é possível verificar privilégios de produção");
    process.exitCode = 1;
    return;
  }

  const pool = createPostgresPool(environment.data.FAREJO_DEPLOY_DATABASE_URL, { max: 5 });
  try {
    const report = await verifyProductionPrivileges(pool);
    console.log(formatPrivilegeVerificationReport(report));
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
