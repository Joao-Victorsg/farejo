import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";

/**
 * F3/T18 (#64, ADR-0041): smoke pós-deploy contra o artefato já publicado na Vercel — nunca
 * contra localhost e nunca com credencial de banco (o site público não expõe nenhuma; este
 * script só fala HTTP com o mesmo domínio que um visitante real usaria). Cobre as rotas do
 * critério de aceite: catálogo, busca, detalhe, ativação/redirect, sitemap, robots e a
 * invalidação HMAC.
 */

const SmokeEnvironment = z.object({
  FAREJO_SITE_URL: z.string().url(),
  FAREJO_CATALOG_INVALIDATION_SECRET: z.string().min(32),
  // ADR-0056: no deploy encenado o alvo é a URL do deployment recém-criado, e a Deployment
  // Protection da Vercel responde 302 para ela (só o domínio de produção é público). Opcional
  // porque o script continua servindo para apontar direto para um domínio público.
  VERCEL_AUTOMATION_BYPASS_SECRET: z.string().min(1).optional(),
});

const STORE_URL_PATTERN = /\/loja\/([^<"&]+)</;
const ACTIVATION_HREF_PATTERN = /href="\/go\/([^/"]+)\/([^/"]+)"/;
const SAMPLE_STORE_LOOKUPS = 10;
const WARM_REQUESTS = 4;
const FETCH_TIMEOUT_MS = 10_000;
// Mesmo padrão do scan local (`test/smoke.mts`), mas contra o HTML já publicado: nenhuma
// credencial de banco, `service_role` ou o segredo HMAC pode escapar para o bundle/HTML.
const SECRET_LEAK_PATTERN = /FAREJO_[A-Z_]*DATABASE_URL|FAREJO_CATALOG_INVALIDATION_SECRET|service_role|postgres(?:ql)?:\/\//;

/**
 * Header de bypass da Deployment Protection (ADR-0056). `x-vercel-set-bypass-cookie: false`
 * mantém o bypass restrito a esta requisição — sem cookie, nada do que o smoke faz deixa uma
 * sessão autenticada para trás.
 */
export function protectionBypassHeaders(secret: string | undefined): Record<string, string> {
  if (!secret) return {};
  return { "x-vercel-protection-bypass": secret, "x-vercel-set-bypass-cookie": "false" };
}

let bypassHeaders: Record<string, string> = {};

function smokeFetch(url: URL, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...bypassHeaders, ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function extractStoreSlugsFromSitemap(xml: string): string[] {
  const matches = [...xml.matchAll(new RegExp(STORE_URL_PATTERN, "g"))];
  return matches.map((match) => decodeURIComponent(match[1]!));
}

export function extractActivationLink(html: string): { storeSlug: string; platformId: string } | null {
  const match = ACTIVATION_HREF_PATTERN.exec(html);
  if (!match) return null;
  return { storeSlug: decodeURIComponent(match[1]!), platformId: decodeURIComponent(match[2]!) };
}

export function signInvalidation(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(timestamp).update(body).digest("hex");
}

function percentile(samplesMs: number[], p: number): number {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(index, 0)] ?? 0;
}

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
  const startedAt = performance.now();
  const value = await run();
  return { value, durationMs: performance.now() - startedAt };
}

export function checkNoLeakedSecrets(name: string, body: string): SmokeCheck {
  const leaked = SECRET_LEAK_PATTERN.exec(body);
  return { name, ok: !leaked, detail: leaked ? `padrão vazado: ${JSON.stringify(leaked[0])}` : "sem padrão de segredo no corpo" };
}

async function checkPage(baseUrl: URL, path: string, expectStatus: number, mustInclude?: string): Promise<SmokeCheck[]> {
  const response = await smokeFetch(new URL(path, baseUrl));
  const body = await response.text();
  const ok = response.status === expectStatus && (!mustInclude || body.includes(mustInclude));
  const statusCheck: SmokeCheck = {
    name: `GET ${path}`,
    ok,
    detail: `status=${response.status}${mustInclude ? ` includes(${JSON.stringify(mustInclude)})=${body.includes(mustInclude)}` : ""}`,
  };
  return [statusCheck, checkNoLeakedSecrets(`GET ${path} (sem segredo vazado)`, body)];
}

async function checkActivation(baseUrl: URL, storeSlug: string, platformId: string): Promise<{ checks: SmokeCheck[]; samplesMs: number[] }> {
  const path = `/go/${encodeURIComponent(storeSlug)}/${encodeURIComponent(platformId)}`;
  const samplesMs: number[] = [];
  const checks: SmokeCheck[] = [];

  const cold = await timed(() => smokeFetch(new URL(path, baseUrl), { redirect: "manual" }));
  samplesMs.push(cold.durationMs);
  const validStatuses = new Set([307, 410, 503]);
  checks.push({
    name: `GET ${path} (cold)`,
    ok: validStatuses.has(cold.value.status),
    detail: `status=${cold.value.status} durationMs=${Math.round(cold.durationMs)}`,
  });

  for (let attempt = 0; attempt < WARM_REQUESTS; attempt += 1) {
    const warm = await timed(() => smokeFetch(new URL(path, baseUrl), { redirect: "manual" }));
    samplesMs.push(warm.durationMs);
    checks.push({
      name: `GET ${path} (warm ${attempt + 1}/${WARM_REQUESTS})`,
      ok: validStatuses.has(warm.value.status),
      detail: `status=${warm.value.status} durationMs=${Math.round(warm.durationMs)}`,
    });
  }

  return { checks, samplesMs };
}

async function checkInvalidation(baseUrl: URL, secret: string): Promise<SmokeCheck[]> {
  const url = new URL("/api/internal/catalog-invalidation", baseUrl);
  const rejected = await smokeFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform_id: "curation", run_id: 0, timestamp: Date.now() }),
  });
  const rejectedCheck: SmokeCheck = { name: "POST catalog-invalidation without signature", ok: rejected.status === 401, detail: `status=${rejected.status}` };

  const timestamp = String(Date.now());
  const body = JSON.stringify({ platform_id: "curation", run_id: 0, timestamp: Number(timestamp) });
  const signature = signInvalidation(secret, timestamp, body);
  const accepted = await smokeFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-farejo-timestamp": timestamp, "x-farejo-signature": signature },
    body,
  });
  const acceptedCheck: SmokeCheck = { name: "POST catalog-invalidation with valid signature", ok: accepted.status === 204, detail: `status=${accepted.status}` };

  return [rejectedCheck, acceptedCheck];
}

export async function runProductionSmoke(baseUrl: URL, invalidationSecret: string): Promise<{ checks: SmokeCheck[]; activationSamplesMs: number[] }> {
  const checks: SmokeCheck[] = [];
  checks.push(...(await checkPage(baseUrl, "/", 200)));
  checks.push(...(await checkPage(baseUrl, "/?q=a", 200)));
  checks.push(...(await checkPage(baseUrl, "/robots.txt", 200, "Disallow: /go/")));

  const sitemapResponse = await smokeFetch(new URL("/sitemap.xml", baseUrl));
  const sitemapXml = await sitemapResponse.text();
  checks.push({ name: "GET /sitemap.xml", ok: sitemapResponse.status === 200 && sitemapXml.includes("<urlset"), detail: `status=${sitemapResponse.status}` });

  const storeSlugs = extractStoreSlugsFromSitemap(sitemapXml).slice(0, SAMPLE_STORE_LOOKUPS);
  let activationSamplesMs: number[] = [];

  if (storeSlugs.length === 0) {
    checks.push({ name: "loja detail + ativação", ok: false, detail: "sitemap.xml não listou nenhuma /loja/<slug>" });
  } else {
    let found: { storeSlug: string; platformId: string } | null = null;
    for (const slug of storeSlugs) {
      const detailResponse = await smokeFetch(new URL(`/loja/${encodeURIComponent(slug)}`, baseUrl));
      const detailHtml = await detailResponse.text();
      checks.push({ name: `GET /loja/${slug}`, ok: detailResponse.status === 200, detail: `status=${detailResponse.status}` });
      checks.push(checkNoLeakedSecrets(`GET /loja/${slug} (sem segredo vazado)`, detailHtml));
      const link = extractActivationLink(detailHtml);
      if (link) {
        found = link;
        break;
      }
    }

    if (!found) {
      checks.push({ name: "ativação (/go/...)", ok: false, detail: `nenhuma das ${storeSlugs.length} lojas amostradas tinha uma oferta ativa para testar o redirect` });
    } else {
      const activation = await checkActivation(baseUrl, found.storeSlug, found.platformId);
      checks.push(...activation.checks);
      activationSamplesMs = activation.samplesMs;
    }
  }

  checks.push(...(await checkInvalidation(baseUrl, invalidationSecret)));

  return { checks, activationSamplesMs };
}

export function formatSmokeReport(checks: SmokeCheck[], activationSamplesMs: number[]): string {
  const lines = checks.map((check) => `${check.ok ? "✅" : "❌"} [smoke-production] ${check.name} — ${check.detail}`);
  if (activationSamplesMs.length > 0) {
    lines.push(
      `ℹ️ [smoke-production] /go latência: p50=${Math.round(percentile(activationSamplesMs, 50))}ms p95=${Math.round(percentile(activationSamplesMs, 95))}ms (cold + ${activationSamplesMs.length - 1} warm, referência ADR-0032: p95 < 500ms)`,
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const environment = SmokeEnvironment.safeParse(process.env);
  if (!environment.success) {
    console.error("[smoke-production] FAREJO_SITE_URL e/ou FAREJO_CATALOG_INVALIDATION_SECRET ausentes; não é possível rodar o smoke de produção");
    process.exitCode = 1;
    return;
  }

  bypassHeaders = protectionBypassHeaders(environment.data.VERCEL_AUTOMATION_BYPASS_SECRET);

  const baseUrl = new URL(environment.data.FAREJO_SITE_URL);
  const { checks, activationSamplesMs } = await runProductionSmoke(baseUrl, environment.data.FAREJO_CATALOG_INVALIDATION_SECRET);
  console.log(formatSmokeReport(checks, activationSamplesMs));
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
