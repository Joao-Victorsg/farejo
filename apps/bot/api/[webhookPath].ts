import { createPostgresPool } from "@farejo/postgres";
import { createBotHandler } from "../src/handler.js";

/**
 * F4/#116 (ADR-0064) — entrypoint da Vercel para `apps/bot`, projeto próprio, separado de
 * `apps/web`.
 *
 * O nome do arquivo (`[webhookPath]`) é só o jeito de o `/api` sem framework aceitar qualquer
 * segmento — a validação de verdade é dentro de `createBotHandler`, contra `FAREJO_BOT_WEBHOOK_PATH`.
 * O segredo da URL não vem do roteamento do Vercel, vem do handler comparando o `pathname` inteiro.
 *
 * Handler e pool são construídos uma vez por cold start (padrão já usado em `apps/web/src/lib/
 * catalog.ts`): variável de ambiente ausente falha explícito na primeira requisição, não no import.
 *
 * `runtime: "nodejs"` explícito (#120): já era o default de projeto sem framework, mas declarado
 * de propósito — documenta a exigência do driver `pg` (socket TCP cru, inviável em edge), mesmo
 * padrão non-negotiable já usado em `apps/web/.../go/[storeSlug]/[platformId]/route.ts`.
 */
export const config = { runtime: "nodejs" };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não configurada`);
  return value;
}

let handleWebhook: ((request: Request) => Promise<Response>) | undefined;

function getHandler(): (request: Request) => Promise<Response> {
  if (handleWebhook) return handleWebhook;

  const pool = createPostgresPool(requiredEnv("FAREJO_BOT_DATABASE_URL"), { max: 1 });
  handleWebhook = createBotHandler({
    pool,
    secretToken: requiredEnv("FAREJO_BOT_WEBHOOK_SECRET"),
    webhookPath: requiredEnv("FAREJO_BOT_WEBHOOK_PATH"),
    siteUrl: requiredEnv("FAREJO_SITE_URL"),
  });
  return handleWebhook;
}

export async function POST(request: Request): Promise<Response> {
  return getHandler()(request);
}
