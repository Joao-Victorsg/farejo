import { pathToFileURL } from "node:url";
import { z } from "zod";

/**
 * F4/#120 (ADR-0065) — smoke pós-deploy do `apps/bot`, contra o deployment ENCENADO (staged,
 * `--skip-domain`), nunca contra o domínio de produção — mesmo padrão do smoke do site (ADR-0056).
 *
 * Duas afirmações, cada uma provando o oposto da outra — a defesa em duas camadas da ADR-0065,
 * cada camada verificada isolada, nenhuma tomada como certa pela outra:
 *
 * 1. Uma requisição SEM nenhum header de bypass, vinda do runner do CI — cujo IP não está nas
 *    faixas do Telegram — tem de ser negada NA BORDA: 403 do Vercel Firewall, documentado e
 *    estável (vercel.com/docs/vercel-firewall/firewall-concepts#deny), nunca um 401 da aplicação.
 *    Prova que a regra de WAF (pendência operacional) está de pé e funcionando.
 * 2. A MESMA requisição, mas com o header de bypass da regra de WAF
 *    (`x-farejo-bot-smoke-bypass`, condição de uma regra de Bypass própria na Vercel, com
 *    prioridade maior que a regra de deny) e um `secret_token` DELIBERADAMENTE errado, tem de
 *    alcançar a aplicação e receber 401 dela — prova que a autenticação de verdade também está de
 *    pé, e que o bypass da regra de rede não é, ele mesmo, uma porta de entrada sem autenticação.
 *
 * `x-farejo-bot-smoke-bypass` não é um mecanismo da Vercel (ao contrário do bypass de Deployment
 * Protection abaixo) — é uma condição que ESTE projeto define, e que a pessoa que criar a regra de
 * WAF precisa configurar manualmente com o mesmo valor de `FAREJO_BOT_WAF_BYPASS_SECRET`.
 */
const SmokeEnvironment = z.object({
  FAREJO_BOT_SITE_URL: z.string().url(),
  FAREJO_BOT_WEBHOOK_PATH: z.string().min(1),
  FAREJO_BOT_WAF_BYPASS_SECRET: z.string().min(1),
  // Deployment Protection da Vercel (ADR-0056): sem isto, TODA requisição ao deployment encenado
  // — inclusive a que testa o 401 — recebe a tela de login antes de alcançar qualquer regra de
  // WAF ou a aplicação. Opcional só para o caso de o alvo já ser um domínio público sem proteção.
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

  // Nenhum header de bypass — nem o de rede, nem o de Deployment Protection. É deliberado: o
  // objetivo é isolar só a camada de rede, exatamente como um pedido hostil de verdade chegaria.
  const denied = await smokeFetch(webhookUrl, {});
  const deniedCheck: SmokeCheck = {
    name: "webhook negado na borda sem o bypass da regra de WAF",
    ok: denied.status === 403,
    detail: `status=${denied.status} (esperado 403 do Vercel Firewall, antes da aplicação)`,
  };

  const reached = await smokeFetch(webhookUrl, {
    ...deploymentProtectionBypassHeaders(environment.VERCEL_AUTOMATION_BYPASS_SECRET),
    [WAF_BYPASS_HEADER]: environment.FAREJO_BOT_WAF_BYPASS_SECRET,
    "x-telegram-bot-api-secret-token": "smoke-secret-propositalmente-errado",
  });
  const reachedCheck: SmokeCheck = {
    name: "webhook com bypass de rede e secret_token errado responde 401 da aplicação",
    ok: reached.status === 401,
    detail: `status=${reached.status} (esperado 401 de createBotHandler, não da Vercel)`,
  };

  return [deniedCheck, reachedCheck];
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
