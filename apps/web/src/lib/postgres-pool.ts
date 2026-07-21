import { Pool, type PoolConfig } from "pg";

/**
 * Fronteira única de TLS das conexões `pg` do site (ADR-0055).
 *
 * O certificado do Postgres/pooler do Supabase não encadeia até uma CA pública: o bundle padrão
 * do Node rejeita a cadeia com `SELF_SIGNED_CERT_IN_CHAIN`. O CA do projeto chega pelo env
 * `FAREJO_SUPABASE_CA_CERT` como PEM inteiro — e não como caminho de arquivo — porque um arquivo
 * exigiria `outputFileTracingIncludes` para sobreviver ao bundle da função serverless.
 *
 * Espelha `apps/scraper/src/postgresPool.ts`: a ADR-0002 mantém `packages/shared` como domínio
 * puro que nunca lê `process.env`, e configuração de I/O é I/O.
 *
 * Deliberadamente SEM `import "server-only"`: `test/verify-production-schema.mts` roda fora do
 * Next (tsx puro, no workflow de deploy) e o pacote `server-only` lança quando resolvido sem a
 * condição `react-server`. Quem guarda a fronteira são os consumidores — `catalog.ts` e
 * `activation.ts` já declaram `server-only`.
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
  // Record, não `NodeJS.ProcessEnv`: o Next augmenta esse tipo exigindo `NODE_ENV`, o que
  // obrigaria todo teste a montar um env falso completo só para checar uma variável.
  environment: Record<string, string | undefined> = process.env,
): PoolConfig["ssl"] {
  assertNoSslModeOverride(connectionString);

  const ca = environment.FAREJO_SUPABASE_CA_CERT;
  if (ca) return { ca, rejectUnauthorized: true };

  // Stack local (`supabase start`) fala sem TLS; forçá-lo quebraria todo o teste de integração.
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
