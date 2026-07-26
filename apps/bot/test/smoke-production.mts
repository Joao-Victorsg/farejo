import { pathToFileURL } from "node:url";
import { z } from "zod";

/**
 * F4/#120 (ADR-0065) — smoke PRÉ-promoção do `apps/bot`, contra o deployment ENCENADO (staged,
 * `--skip-domain`), nunca contra o domínio de produção — mesmo padrão do smoke do site (ADR-0056).
 *
 * Só uma afirmação aqui: com os dois bypasses (Deployment Protection + regra de WAF) e um
 * `secret_token` deliberadamente errado, a resposta tem que ser `401` da PRÓPRIA APLICAÇÃO — prova
 * que o artefato recém-buildado está de pé e sua lógica de autenticação funciona, o gate que
 * bloqueia "Promote to production" se falhar.
 *
 * Esta checagem NÃO prova que a regra de WAF está configurada (só que, com o bypass certo, ela
 * DEIXA passar) — ver o passo "Confirm WAF on production domain" do `deploy-bot.yml` pra isso.
 *
 * **Por que os DOIS bypasses são necessários aqui, achado corrigido ao vivo redisparando o
 * `deploy-bot.yml` depois do primeiro conserto:** a ordem de avaliação documentada da Vercel é
 * Firewall da plataforma → Deployment Protection → WAF do projeto
 * (vercel.com/blog/life-of-a-request-securing-your-apps-traffic-with-vercel). Numa deployment
 * staged, a Deployment Protection intercepta QUALQUER requisição sem o bypass dela ANTES de a WAF
 * ser avaliada — então "sem bypass nenhum → 403 da WAF" nunca é observável aqui (confirmado ao
 * vivo: sem headers, staged devolve 401/302 da Deployment Protection, nunca chega na WAF). Mas uma
 * vez que o bypass de Deployment Protection é aceito, a requisição PROSSEGUE e a WAF do projeto A
 * AVALIA DE VERDADE — e a regra de Deny (fora das faixas do Telegram) nega o runner do GitHub
 * Actions com 403 se o bypass da WAF não vier junto. A primeira tentativa desta correção removeu o
 * bypass da WAF daqui, achando que só o domínio de produção promovido passava pela WAF — errado: a
 * WAF do projeto vale pra QUALQUER deployment (staged ou promovida), só que numa staged ela fica
 * atrás do gate de Deployment Protection. `x-farejo-bot-smoke-bypass` não é um mecanismo da Vercel
 * — é uma condição que este projeto define numa regra de Bypass própria, prioridade maior que a de
 * Deny.
 */
const SmokeEnvironment = z.object({
  FAREJO_BOT_SITE_URL: z.string().url(),
  FAREJO_BOT_WEBHOOK_PATH: z.string().min(1),
  FAREJO_BOT_WAF_BYPASS_SECRET: z.string().min(1),
  // Deployment Protection da Vercel (ADR-0056): sem isto, TODA requisição ao deployment encenado
  // recebe a tela de login antes de alcançar a WAF ou a aplicação. Opcional só para o caso de o
  // alvo já ser um domínio público sem proteção.
  VERCEL_AUTOMATION_BYPASS_SECRET: z.string().min(1).optional(),
});

const FETCH_TIMEOUT_MS = 10_000;
const WAF_BYPASS_HEADER = "x-farejo-bot-smoke-bypass";

export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** Header de bypass da Deployment Protection (ADR-0056) — mesmo mecanismo do smoke de `apps/web`. */
function deploymentProtectionBypassHeaders(secret: string | undefined): Record<string, string> {
  if (!secret) return {};
  return { "x-vercel-protection-bypass": secret, "x-vercel-set-bypass-cookie": "false" };
}

function smokeFetch(url: URL, headers: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ update_id: 0 }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

export async function runBotSmoke(environment: z.infer<typeof SmokeEnvironment>): Promise<SmokeCheck[]> {
  const webhookUrl = new URL(`/api/${environment.FAREJO_BOT_WEBHOOK_PATH}`, environment.FAREJO_BOT_SITE_URL);

  const reached = await smokeFetch(webhookUrl, {
    ...deploymentProtectionBypassHeaders(environment.VERCEL_AUTOMATION_BYPASS_SECRET),
    [WAF_BYPASS_HEADER]: environment.FAREJO_BOT_WAF_BYPASS_SECRET,
    "x-telegram-bot-api-secret-token": "smoke-secret-propositalmente-errado",
  });
  const reachedCheck: SmokeCheck = {
    name: "webhook com secret_token errado responde 401 da aplicação",
    ok: reached.status === 401,
    detail: `status=${reached.status} (esperado 401 de createBotHandler)`,
  };

  return [reachedCheck];
}

export function hasSmokeFailure(checks: SmokeCheck[]): boolean {
  return checks.some((check) => !check.ok);
}

export function formatSmokeReport(checks: SmokeCheck[]): string {
  const lines = checks.map((check) => `${check.ok ? "✅" : "❌"} [smoke-bot] ${check.name} — ${check.detail}`);
  const failures = checks.filter((check) => !check.ok).length;
  lines.push(`ℹ️ [smoke-bot] ${checks.length - failures} ok · ${failures} falha(s)`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const environment = SmokeEnvironment.safeParse(process.env);
  if (!environment.success) {
    console.error("[smoke-bot] variáveis obrigatórias ausentes; não é possível rodar o smoke do bot");
    process.exitCode = 1;
    return;
  }

  const checks = await runBotSmoke(environment.data);
  console.log(formatSmokeReport(checks));
  if (hasSmokeFailure(checks)) process.exitCode = 1;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
