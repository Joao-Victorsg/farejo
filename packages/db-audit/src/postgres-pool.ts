import { Pool, type PoolConfig } from "pg";

/**
 * Fronteira de TLS das conexões `pg` da auditoria de banco (ADR-0055).
 *
 * O certificado do Postgres/pooler do Supabase não encadeia até uma CA pública: o bundle padrão
 * do Node rejeita a cadeia com `SELF_SIGNED_CERT_IN_CHAIN`. O CA do projeto chega pelo env
 * `FAREJO_SUPABASE_CA_CERT` como PEM inteiro.
 *
 * ⚠️ Terceira cópia desta lógica — as outras são `apps/web/src/lib/postgres-pool.ts` e
 * `apps/scraper/src/postgresPool.ts`. A duplicação é deliberada e temporária: consolidar as três
 * num `@farejo/postgres` exigiria mexer no caminho de runtime do site (bundling da função
 * serverless, a condição `react-server` do pacote `server-only`), risco que não pertence ao
 * ticket que criou este pacote. Cada cópia carrega o próprio teste; mudança na ADR-0055 precisa
 * chegar nas três até a consolidação acontecer.
 *
 * `packages/shared` não é candidato a receber isto: a ADR-0002 o mantém como domínio puro que
 * nunca lê `process.env`, e configuração de I/O é I/O.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function hostOf(connectionString: string): string {
  try {
    return new URL(connectionString).hostname;
  } catch {
    // Connection string em formato não-URL (raro): trata como remota, que é o lado seguro.
    return "";
  }
}

/**
 * `pg` resolve `new Pool({ connectionString, ssl })` como
 * `Object.assign({}, config, parse(connectionString))` — o parse VENCE. E
 * `pg-connection-string` cria `config.ssl = {}` sempre que enxerga `sslmode` na URL. Um
 * `?sslmode=require` sobrevivente descartaria o CA abaixo em silêncio e o erro voltaria a ser
 * `SELF_SIGNED_CERT_IN_CHAIN`, sem nada apontando para a causa. Falhamos explícito em vez disso.
 */
function assertNoSslModeOverride(connectionString: string): void {
  if (/[?&]sslmode=/i.test(connectionString)) {
    throw new Error(
      "Connection string não pode conter `sslmode`: ele sobrescreve e descarta o CA de FAREJO_SUPABASE_CA_CERT (ADR-0055). Remova o parâmetro da URL.",
    );
  }
}

export function resolvePostgresSsl(
  connectionString: string,
  environment: Record<string, string | undefined> = process.env,
): PoolConfig["ssl"] {
  assertNoSslModeOverride(connectionString);

  const ca = environment.FAREJO_SUPABASE_CA_CERT;
  if (ca) return { ca, rejectUnauthorized: true };

  // Stack local (`supabase start`) fala sem TLS; forçá-lo quebraria a auditoria local.
  if (LOCAL_HOSTS.has(hostOf(connectionString))) return undefined;

  // Host remoto sem CA: recusa em vez de degradar para uma conexão não verificada em silêncio.
  throw new Error(
    "FAREJO_SUPABASE_CA_CERT ausente para uma conexão Postgres remota (ADR-0055). Configure a variável de ambiente antes de conectar.",
  );
}

export function createPostgresPool(
  connectionString: string,
  options: Omit<PoolConfig, "connectionString" | "ssl"> = {},
): Pool {
  return new Pool({ ...options, connectionString, ssl: resolvePostgresSsl(connectionString) });
}
