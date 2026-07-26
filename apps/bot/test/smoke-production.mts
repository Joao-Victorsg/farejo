import { pathToFileURL } from "node:url";
import { z } from "zod";

/**
 * F4/#120 (ADR-0065) — smoke PRÉ-promoção do `apps/bot`, contra o deployment ENCENADO (staged,
 * `--skip-domain`), nunca contra o domínio de produção — mesmo padrão do smoke do site (ADR-0056).
 *
 * Só uma afirmação aqui: com o bypass de Deployment Protection e um `secret_token` deliberadamente
 * errado, a resposta tem que ser `401` da PRÓPRIA APLICAÇÃO — prova que o artefato recém-buildado
 * está de pé e sua lógica de autenticação funciona, o gate que bloqueia "Promote to production" se
 * falhar.
 *
 * Esta checagem NÃO prova nada sobre a regra de WAF (rede). Até a correção pós-#120, este arquivo
 * também tentava provar "requisição sem bypass é negada na borda com 403" — mas regras de WAF
 * customizadas da Vercel só valem para o domínio de PRODUÇÃO promovido, nunca para uma deployment
 * staged/`--skip-domain` (confirmado ao vivo: a mesma requisição sem headers contra o domínio real
 * recebe 403 do Firewall com `X-Vercel-Mitigated: deny`; contra esta URL staged recebe 401 da
 * Deployment Protection — um subsistema totalmente diferente, que nem chega a avaliar a regra de
 * WAF). Testar isso aqui faria essa checagem falhar SEMPRE, mesmo com a regra perfeitamente
 * configurada, travando "Promote to production" para sempre. A verificação de WAF de verdade só é
 * possível DEPOIS da promoção, contra o domínio real — é o passo "Confirm WAF on production domain"
 * do `deploy-bot.yml`, não-bloqueante (a publicação já aconteceu; uma regra de WAF é configuração
 * de conta da Vercel, não parte do artefato, e se conserta no dashboard, não revertendo o deploy).
 */
const SmokeEnvironment = z.object({
  FAREJO_BOT_SITE_URL: z.string().url(),
  FAREJO_BOT_WEBHOOK_PATH: z.string().min(1),
  // Deployment Protection da Vercel (ADR-0056): sem isto, TODA requisição ao deployment encenado
  // recebe a tela de login antes de alcançar a aplicação. Opcional só para o caso de o alvo já ser
  // um domínio público sem proteção.
  VERCEL_AUTOMATION_BYPASS_SECRET: z.string().min(1).optional(),
});

const FETCH_TIMEOUT_MS = 10_000;

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
