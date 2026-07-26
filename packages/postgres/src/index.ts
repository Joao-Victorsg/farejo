import { Pool, type PoolConfig } from "pg";

/**
 * Fronteira única de TLS de TODA conexão `pg` do projeto (ADR-0055).
 *
 * O certificado do Postgres/pooler do Supabase não encadeia até uma CA pública: o bundle padrão
 * do Node rejeita a cadeia com `SELF_SIGNED_CERT_IN_CHAIN`. O CA do projeto chega pelo env
 * `FAREJO_SUPABASE_CA_CERT` como PEM inteiro — e não como caminho de arquivo — para valer igual
 * em GitHub Actions e na Vercel, sem depender de cwd relativo nem de `outputFileTracingIncludes`.
 *
 * Este pacote existe porque a lógica é a mesma para todos os consumidores e precisa mudar num
 * lugar só: até a #112 ela vivia em três cópias (`apps/web`, `apps/scraper`, `packages/db-audit`),
 * e a ADR-0055 exigia que qualquer alteração chegasse nas três — o tipo de acordo que diverge em
 * silêncio. `packages/shared` não é candidato a recebê-la: a ADR-0002 o mantém como domínio puro
 * que nunca lê `process.env`, e configuração de I/O é I/O.
 *
 * Deliberadamente SEM `import "server-only"`, apesar de o site ser consumidor: o pacote também é
 * usado fora do Next (scraper e auditoria de banco), e `server-only` lança quando resolvido sem a
 * condição `react-server`. Quem guarda essa fronteira no site são os consumidores — `catalog.ts` e
 * `activation.ts` já declaram `server-only`.
 *
 * O pacote tem build de verdade (`pnpm build` → `tsc -p tsconfig.build.json`, `main`/`types`
 * apontam pra `dist/`), disparado sozinho pelo `postinstall` da raiz — nenhum consumidor precisa
 * lembrar de rodar nada. Até a #120 ele era só TypeScript-fonte (`main: "src/index.ts"`), o que
 * funcionava pra quem transpila TS nativamente (tsx, vitest, o `transpilePackages` do Next) mas
 * quebrou de verdade em produção no empacotador de Função Node.js da Vercel (usado por `apps/bot`,
 * projeto sem Next): ele compila só o entrypoint e deixa o import deste pacote apontando pro `.ts`
 * cru, que não existe executável no bundle — `ERR_MODULE_NOT_FOUND`, confirmado ao vivo via
 * `vercel logs`. Compilar pra `dist/` faz este pacote se comportar como qualquer dependência npm
 * normal (igual `pg`, que sempre empacotou sem problema), removendo a categoria inteira de
 * "este bundler sabe lidar com TS cru?" em vez de resolver caso a caso.
 *
 * `transpilePackages: ["@farejo/postgres"]` no `next.config.ts` do site fica como defesa em
 * profundidade inofensiva — não é mais obrigatória, já que `main` aponta pra JS de verdade.
 *
 * ⚠️ Tudo continua num arquivo só, sem barrel, mas por simplicidade agora — não por necessidade.
 * Se um dia ganhar um segundo módulo, a regra INVERTE em relação à era pré-#120: um import
 * relativo interno passa a precisar da extensão `.js` EXPLÍCITA (`from "./pool.js"`, nunca
 * `"./pool"`), porque `dist/*.js` roda direto sob o resolvedor ESM do Node (`"type": "module"`),
 * que exige extensão — o oposto do que o Turbopack aceitava transpilando TS cru. O typecheck NÃO
 * pega esse erro (`moduleResolution: "bundler"`, herdado, permite sem extensão): só o `tsc -p
 * tsconfig.build.json` real ou uma execução de verdade contra `dist/` revelam a falta.
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
    "FAREJO_SUPABASE_CA_CERT ausente para uma conexão Postgres remota (ADR-0055). Configure a variável de ambiente (secret do repositório nas Actions, variável do projeto na Vercel) antes de conectar.",
  );
}

export function createPostgresPool(
  connectionString: string,
  options: Omit<PoolConfig, "connectionString" | "ssl"> = {},
): Pool {
  return new Pool({ ...options, connectionString, ssl: resolvePostgresSsl(connectionString) });
}
