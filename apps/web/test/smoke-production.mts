import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { type AliasManifest, l2Key, parseAliasManifest } from "@farejo/shared";
import { z } from "zod";

/**
 * F3/T18 (#64, ADR-0041): smoke pós-deploy contra o artefato já publicado na Vercel — nunca
 * contra localhost e nunca com credencial de banco (o site público não expõe nenhuma; este
 * script só fala HTTP com o mesmo domínio que um visitante real usaria). Cobre as rotas do
 * critério de aceite: catálogo, busca, detalhe, ativação/redirect, sitemap, robots e a
 * invalidação HMAC.
 *
 * Ampliação (ADR-0059): páginas editoriais (/plataformas, /como-funciona, /faq), paginação,
 * ordenações, markup do toggle de correntista, redirect de alias e os negativos 404/410. A
 * hidratação do bundle publicado — que nenhuma asserção sobre HTML alcança — fica em
 * test/smoke-production-browser.mts, passo separado do mesmo deployment encenado.
 *
 * Duas regras que valem para todo check adicionado aqui:
 *
 * 1. STATUS NUNCA BASTA. `/` e `/plataformas` capturam a falha de banco e renderizam um estado
 *    de erro com HTTP 200 (`HomeError`, `PlatformsError`) — um check de status sozinho aprova
 *    um deploy servindo o site inteiro quebrado. Toda página com fallback de erro exige
 *    asserção de conteúdo e `mustNotInclude` do texto do próprio fallback.
 * 2. SEMÂNTICA NÃO SE REVALIDA AQUI. Ordenação, relevância e paginação já são cobertas contra o
 *    SQL real em test/catalog-search-db.test.ts e test/platform-stats-db.test.ts; 503 de
 *    ativação, em test/activation.test.ts. Este arquivo prova que o ARTEFATO PUBLICADO serve
 *    essas rotas contra o banco de produção — não rededuz as regras. Asserções acopladas a
 *    classes Tailwind foram deliberadamente evitadas: quebram em qualquer mudança de estilo e
 *    o falso alarme cairia no caminho de publicação.
 */

const SmokeEnvironment = z.object({
  FAREJO_SITE_URL: z.string().url(),
  // Opcional só para o modo somente-leitura abaixo; o refine adiante o exige em qualquer outro
  // caso, para o passo do deploy nunca rodar sem o check de invalidação por esquecimento.
  FAREJO_CATALOG_INVALIDATION_SECRET: z.string().min(32).optional(),
  // ADR-0056: no deploy encenado o alvo é a URL do deployment recém-criado, e a Deployment
  // Protection da Vercel responde 302 para ela (só o domínio de produção é público). Opcional
  // porque o script continua servindo para apontar direto para um domínio público.
  VERCEL_AUTOMATION_BYPASS_SECRET: z.string().min(1).optional(),
  /**
   * Modo diagnóstico para apontar o smoke a uma produção JÁ no ar sem alterá-la — responder
   * "o site está de pé agora?" sem sujar dado real. Nunca usado pelo workflow de publicação.
   */
  FAREJO_SMOKE_READ_ONLY: z.literal("1").optional(),
}).refine(
  (environment) => environment.FAREJO_SMOKE_READ_ONLY === "1" || environment.FAREJO_CATALOG_INVALIDATION_SECRET !== undefined,
  { message: "FAREJO_CATALOG_INVALIDATION_SECRET é obrigatório fora do modo somente-leitura" },
);

const STORE_URL_PATTERN = /\/loja\/([^<"&]+)</;
const ACTIVATION_HREF_PATTERN = /href="\/go\/([^/"]+)\/([^/"]+)"/;
const SAMPLE_STORE_LOOKUPS = 10;
const WARM_REQUESTS = 4;
const FETCH_TIMEOUT_MS = 10_000;
const CATALOG_PAGE_SIZE = 24;
/** Nome de plataforma é dado de produção, mas as cinco canônicas são fixas (ADR-0019). */
const CANONICAL_PLATFORM_NAMES = ["Méliuz", "Cuponomia", "MyCashback", "Zoom", "Shopping Inter"];
/** Plataforma que nunca existirá: força `activation.resolve_destination` a devolver zero linhas. */
const FORGED_PLATFORM_ID = "plataforma-inexistente-smoke";
const FORGED_STORE_SLUG = "loja-inexistente-smoke-producao";
// Mesmo padrão do scan local (`test/smoke.mts`), mas contra o HTML já publicado: nenhuma
// credencial de banco, `service_role` ou o segredo HMAC pode escapar para o bundle/HTML.
const SECRET_LEAK_PATTERN = /FAREJO_[A-Z_]*DATABASE_URL|FAREJO_CATALOG_INVALIDATION_SECRET|service_role|postgres(?:ql)?:\/\//;

/**
 * Guarda anti-skeleton, portada de test/smoke.mts: páginas `force-dynamic` streamam o
 * `loading.tsx` antes de trocar pelo conteúdo real dentro da MESMA resposta, então um
 * `fetch` pode observar o esqueleto. Casa a tag renderizada, não a substring solta — o Next
 * também embute `\"id\":\"conteudo\"` no payload RSC (`self.__next_f.push`), que daria falso
 * positivo de "pronto" com o HTML visível ainda no esqueleto.
 */
const RENDERED_MARKER = /<main[^>]* id="conteudo"/;
const RENDER_ATTEMPTS = 20;
const RENDER_RETRY_MS = 250;

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
  /**
   * Resultado que ESTA execução não conseguiu verificar por ausência de dado em produção (ex.:
   * nenhum merge de alias declarado ainda), e não por regressão do deploy. Sai como ℹ️ e não
   * reprova a publicação — mesma convenção do Telegram em `summary.ts` e da cobertura de logos.
   * Nunca usar para mascarar um desfecho ruim: o texto tem que dizer o que ficou sem verificar.
   */
  informational?: boolean;
}

function info(name: string, detail: string): SmokeCheck {
  return { name, ok: true, detail, informational: true };
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

/** Slugs dos cards do catálogo, na ordem renderizada. Um `<a href="/loja/...">` por card. */
export function extractStoreCardSlugs(html: string): string[] {
  const matches = [...html.matchAll(/<a[^>]+href="\/loja\/([^"#]+)"/g)];
  return matches.map((match) => decodeURIComponent(match[1]!));
}

/**
 * Total de páginas pelo nome acessível da navegação de paginação. Usa `aria-label` de
 * propósito: é contrato de acessibilidade, estável por desenho — ao contrário de classe CSS.
 */
export function readPaginationTotalPages(html: string): number | null {
  const match = /aria-label="Paginação do catálogo, página (\d+) de (\d+)"/.exec(html);
  return match ? Number(match[2]) : null;
}

/** Página marcada como atual (`aria-current="page"`), que é o que o leitor de tela anuncia. */
export function readCurrentPaginationPage(html: string): number | null {
  const match = /aria-current="page"[^>]*>(\d+)</.exec(html);
  return match ? Number(match[1]) : null;
}

/** Rótulo da ordenação ativa (`aria-current="true"` nos controles de `CatalogControls`). */
export function readActiveSortLabel(html: string): string | null {
  const match = /aria-current="true"[^>]*>([^<]+)</.exec(html);
  return match ? match[1]!.trim() : null;
}

/**
 * O toggle é cliente puro (`localStorage`, src/lib/inter-preference.tsx): o SSR sempre entrega
 * o padrão LIGADO. Por HTTP dá para provar exatamente isto — que o switch existe com o nome
 * acessível certo e o default ligado da ADR-0034. O COMPORTAMENTO (reordenar, persistir) e a
 * hidratação do bundle publicado ficam em test/smoke-production-browser.mts.
 */
export function readInterSwitchState(html: string): "on" | "off" | "absent" {
  const button = /<button[^>]*aria-label="Sou correntista Inter"[^>]*>/.exec(html);
  if (!button) return "absent";
  return /aria-checked="true"/.test(button[0]) ? "on" : "off";
}

export function isNoindex(html: string): boolean {
  const meta = /<meta[^>]*name="robots"[^>]*>/.exec(html);
  return meta ? /content="[^"]*noindex/.test(meta[0]) : false;
}

/** `<link rel="canonical">` reduzido a path+query — `metadataBase` o torna absoluto. */
export function readCanonicalPath(html: string): string | null {
  const link = /<link[^>]*rel="canonical"[^>]*>/.exec(html);
  const href = link ? /href="([^"]+)"/.exec(link[0]) : null;
  if (!href) return null;
  try {
    const url = new URL(href[1]!, "https://smoke.invalid");
    return `${url.pathname}${url.search}`;
  } catch {
    return href[1]!;
  }
}

/**
 * Pares (slug absorvido -> slug canônico) derivados do manifesto de curadoria versionado no Git
 * — sem banco e sem secret. `stores.slug` É a chave L2 do nome cru
 * (apps/scraper/src/pipeline/store.ts), e `apply_alias_merge` grava exatamente esse slug como
 * `store_slug_redirects.from_slug`, então o par é derivável do que o manifesto já declara.
 *
 * `from === to` é descartado aqui: o nome cru já normalizava para a canônica, ela nunca foi
 * absorvida e nenhuma linha de redirect é criada.
 */
export function aliasRedirectPairs(manifest: AliasManifest): { from: string; to: string }[] {
  const pairs = manifest.merges.flatMap((merge) =>
    merge.aliases.map((alias) => ({ from: l2Key(alias.rawName), to: merge.canonicalSlug })),
  );
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    if (pair.from === pair.to || seen.has(pair.from)) return false;
    seen.add(pair.from);
    return true;
  });
}

export function loadAliasManifest(): AliasManifest | null {
  try {
    const path = new URL("../../../curation/aliases-manifest.json", import.meta.url);
    return parseAliasManifest(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
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

interface PageExpectation {
  expectStatus?: number;
  /** Espera o conteúdo real substituir o `loading.tsx`. Desligar só para 3xx. */
  requireRendered?: boolean;
  mustInclude?: string[];
  /** Texto que prova que a página caiu no próprio fallback de erro — ver regra 1 no topo. */
  mustNotInclude?: string[];
}

interface PageResult {
  checks: SmokeCheck[];
  status: number;
  html: string;
}

async function fetchRendered(url: URL, requireRendered: boolean): Promise<{ status: number; html: string }> {
  let last = { status: 0, html: "" };
  for (let attempt = 0; attempt < (requireRendered ? RENDER_ATTEMPTS : 1); attempt += 1) {
    const response = await smokeFetch(url);
    last = { status: response.status, html: await response.text() };
    if (!requireRendered || last.status !== 200 || RENDERED_MARKER.test(last.html)) return last;
    await wait(RENDER_RETRY_MS);
  }
  return last;
}

async function checkPage(baseUrl: URL, path: string, expectation: PageExpectation = {}): Promise<PageResult> {
  const { expectStatus = 200, requireRendered = true, mustInclude = [], mustNotInclude = [] } = expectation;
  const { status, html } = await fetchRendered(new URL(path, baseUrl), requireRendered);

  const missing = mustInclude.filter((needle) => !html.includes(needle));
  const forbidden = mustNotInclude.filter((needle) => html.includes(needle));
  const rendered = !requireRendered || RENDERED_MARKER.test(html);
  const details = [`status=${status}`];
  if (requireRendered) details.push(`renderizado=${rendered}`);
  if (missing.length > 0) details.push(`faltando=${JSON.stringify(missing)}`);
  if (forbidden.length > 0) details.push(`presente indevidamente=${JSON.stringify(forbidden)}`);

  return {
    checks: [
      {
        name: `GET ${path}`,
        ok: status === expectStatus && rendered && missing.length === 0 && forbidden.length === 0,
        detail: details.join(" "),
      },
      checkNoLeakedSecrets(`GET ${path} (sem segredo vazado)`, html),
    ],
    status,
    html,
  };
}

/** Alvo de um `<meta http-equiv="refresh">` — padrão web, não token interno do framework. */
export function readMetaRefreshTarget(html: string): string | null {
  const meta = /<meta[^>]*http-equiv="refresh"[^>]*>/i.exec(html);
  const content = meta ? /content="[^";]*;\s*url=([^"]+)"/i.exec(meta[0]) : null;
  return content ? content[1]!.trim() : null;
}

function toPath(url: URL): string {
  return `${url.pathname}${url.search}`;
}

interface RedirectObservation {
  status: number;
  /** "http" = 3xx com Location; "stream" = 200 com meta refresh; null = nenhum redirect. */
  via: "http" | "stream" | null;
  path: string | null;
  html: string;
}

/**
 * MEDIDO CONTRA O ARTEFATO CONSTRUÍDO (23/07/2026): nem `redirect()` nem `permanentRedirect()`
 * viram 3xx neste app. Como existe `loading.tsx`, o Next transmite o shell antes de a página
 * resolver, o status já saiu como 200, e o redirect degrada para
 * `<meta http-equiv="refresh" content="N;url=…">` mais `NEXT_REDIRECT;replace;…;307|308` no
 * payload RSC. Vale para os três casos: canonicalização do catálogo, sort inválido e o redirect
 * de alias absorvido.
 *
 * Esta função observa as DUAS formas e diz qual encontrou. Fixar 3xx produziria vermelho
 * permanente no caminho de publicação por uma condição pré-existente; aceitar qualquer 200
 * deixaria a perda total do redirect passar. O meio-termo correto é exigir que o visitante SEJA
 * mandado ao alvo certo, por qualquer um dos dois mecanismos, e registrar qual — se o
 * comportamento for corrigido para 3xx de verdade, o check continua passando e o log mostra.
 */
async function observeRedirect(baseUrl: URL, path: string): Promise<RedirectObservation> {
  const response = await smokeFetch(new URL(path, baseUrl), { redirect: "manual" });
  const location = response.headers.get("location");
  if (location && response.status >= 300 && response.status < 400) {
    return { status: response.status, via: "http", path: toPath(new URL(location, baseUrl)), html: "" };
  }

  const html = await response.text();
  const meta = readMetaRefreshTarget(html);
  if (response.status === 200 && meta) {
    return { status: response.status, via: "stream", path: toPath(new URL(meta, baseUrl)), html };
  }
  return { status: response.status, via: null, path: null, html };
}

function describeRedirect(observation: RedirectObservation, expectPath: string): string {
  if (observation.via === "http") return `HTTP ${observation.status} → ${observation.path}`;
  if (observation.via === "stream") return `HTTP 200 + meta refresh → ${observation.path} (shell do loading.tsx já transmitido; redirect não vira 3xx)`;
  return `status=${observation.status} sem redirect algum esperado=${JSON.stringify(expectPath)}`;
}

/** Canonicalização do catálogo (src/lib/catalog.ts `needsCanonicalRedirect`). */
async function checkCanonicalization(baseUrl: URL, path: string, expectPath: string): Promise<SmokeCheck> {
  const observation = await observeRedirect(baseUrl, path);
  return {
    name: `GET ${path} (canonicalização)`,
    ok: observation.via !== null && observation.path === expectPath,
    detail: describeRedirect(observation, expectPath),
  };
}

/**
 * Loja inexistente. MEDIDO (23/07/2026): pela mesma razão do redirect acima, `notFound()`
 * responde HTTP 200 com o boundary de 404 no payload RSC, não HTTP 404 — o `<main
 * id="conteudo">` do not-found.tsx nem chega no HTML servido. Uma rota SEM página nenhuma
 * (`/rota-inexistente`) continua devolvendo 404 de verdade, então isto é específico do
 * `notFound()` sob streaming.
 *
 * A asserção é sobre o texto do produto, não sobre o token interno do Next
 * (`NEXT_HTTP_ERROR_FALLBACK;404`), e 5xx continua reprovando.
 */
async function checkStoreNotFound(baseUrl: URL): Promise<SmokeCheck[]> {
  const path = `/loja/${FORGED_STORE_SLUG}`;
  const response = await smokeFetch(new URL(path, baseUrl));
  const html = await response.text();
  const identified = html.includes("Loja não encontrada");

  return [
    {
      name: `GET ${path} (loja inexistente)`,
      ok: identified && (response.status === 404 || response.status === 200),
      detail: `status=${response.status} identificada como inexistente=${identified}`
        + (response.status === 200 ? " (notFound() sob streaming: 404 entregue no payload, não no status)" : ""),
    },
    checkNoLeakedSecrets(`GET ${path} (sem segredo vazado)`, html),
  ];
}

async function checkEditorialPages(baseUrl: URL): Promise<SmokeCheck[]> {
  const checks: SmokeCheck[] = [];

  // Estáticas: sem banco, sem fallback de erro — basta o conteúdo próprio de cada uma.
  checks.push(...(await checkPage(baseUrl, "/como-funciona", { mustInclude: ["Como o farejô funciona"] })).checks);
  checks.push(...(await checkPage(baseUrl, "/faq", { mustInclude: ["Perguntas frequentes"] })).checks);

  // /plataformas lê `web_read.platform_stats()`: se o GRANT cair, a página responde 200 com
  // PlatformsError. As cinco canônicas são fixas na função (ADR-0019), então exigir os cinco
  // nomes é estável contra qualquer dado de produção.
  checks.push(...(await checkPage(baseUrl, "/plataformas", {
    mustInclude: CANONICAL_PLATFORM_NAMES,
    mustNotInclude: ["Não conseguimos carregar as estatísticas"],
  })).checks);

  return checks;
}

interface CatalogHome {
  checks: SmokeCheck[];
  totalPages: number | null;
  cardCount: number;
  cardSlugs: string[];
}

/**
 * Amostra de lojas para os checks de detalhe, ativação e toggle. Combina duas fontes de
 * propósito: os cards da home vêm ordenados por cobertura ("Mais plataformas"), então concentram
 * as lojas presentes em mais plataformas — inclusive o Inter, que o toggle exige; o sitemap está
 * em ordem alfabética e começa pela cauda longa.
 *
 * MEDIDO CONTRA PRODUÇÃO (23/07/2026): 8 de 8 das primeiras lojas da home tinham oferta do Inter,
 * contra 1 de 8 das primeiras do sitemap (`1password`, `24s`, `361sport`, `4kids`…). Amostrar só
 * o sitemap fazia o check do toggle — e o smoke de browser INTEIRO, cujo único propósito é
 * hidratação — degradar para "não verificado" justamente em produção, onde deveriam valer.
 * Manter as duas fontes preserva a prova de que um slug listado no sitemap resolve.
 */
export function storeSample(cardSlugs: string[], sitemapSlugs: string[]): string[] {
  const half = Math.ceil(SAMPLE_STORE_LOOKUPS / 2);
  return [...new Set([...cardSlugs.slice(0, half), ...sitemapSlugs.slice(0, half)])];
}

async function checkCatalogHome(baseUrl: URL): Promise<CatalogHome> {
  const home = await checkPage(baseUrl, "/", {
    mustNotInclude: ["Não conseguimos carregar as lojas", "O catálogo está temporariamente vazio"],
  });
  const checks = [...home.checks];
  const cardSlugs = [...new Set(extractStoreCardSlugs(home.html))];
  const cardCount = cardSlugs.length;
  const totalPages = readPaginationTotalPages(home.html);

  checks.push({
    name: "GET / (catálogo com cards)",
    ok: cardCount > 0 && cardCount <= CATALOG_PAGE_SIZE,
    detail: `cards=${cardCount} (máximo por página=${CATALOG_PAGE_SIZE})`,
  });
  checks.push({
    name: "GET / (ordenação padrão ativa)",
    ok: readActiveSortLabel(home.html) === "Mais plataformas",
    detail: `ordenação ativa=${JSON.stringify(readActiveSortLabel(home.html))}`,
  });
  checks.push({
    name: "GET / (toggle correntista Inter, padrão ligado)",
    ok: readInterSwitchState(home.html) === "on",
    detail: `switch=${readInterSwitchState(home.html)} (comportamento e hidratação: smoke-production-browser)`,
  });
  checks.push({
    name: "GET / (indexável)",
    ok: !isNoindex(home.html),
    detail: `noindex=${isNoindex(home.html)} canonical=${JSON.stringify(readCanonicalPath(home.html))}`,
  });

  return { checks, totalPages, cardCount, cardSlugs };
}

async function checkPagination(baseUrl: URL, totalPages: number | null): Promise<SmokeCheck[]> {
  const checks: SmokeCheck[] = [];

  // `?page=1`, `?page=0`, `?page=abc` e `?page=<fora de alcance>` são desfechos DIFERENTES no
  // parser (src/lib/catalog.ts:148): o primeiro é canonicalização, os demais renderizam a
  // branch "Esta página não existe." com 200 + noindex — nunca 404.
  checks.push(await checkCanonicalization(baseUrl, "/?page=1", "/"));

  for (const path of ["/?page=0", "/?page=abc", "/?page=99999"]) {
    const result = await checkPage(baseUrl, path, { mustInclude: ["Esta página não existe."] });
    checks.push(...result.checks);
    checks.push({
      name: `GET ${path} (noindex)`,
      ok: isNoindex(result.html),
      detail: `noindex=${isNoindex(result.html)}`,
    });
  }

  if (totalPages === null || totalPages < 2) {
    checks.push(info(
      "GET /?page=2 (segunda página)",
      `catálogo com ${totalPages === null ? "paginação ausente" : `${totalPages} página(s)`} — segunda página NÃO verificada nesta execução`,
    ));
    return checks;
  }

  const second = await checkPage(baseUrl, "/?page=2", {
    mustNotInclude: ["Não conseguimos carregar as lojas", "Esta página não existe."],
  });
  checks.push(...second.checks);
  checks.push({
    name: "GET /?page=2 (página atual marcada)",
    ok: readCurrentPaginationPage(second.html) === 2 && extractStoreCardSlugs(second.html).length > 0,
    detail: `aria-current=${readCurrentPaginationPage(second.html)} cards=${extractStoreCardSlugs(second.html).length}`,
  });

  return checks;
}

async function checkSorts(baseUrl: URL, totalPages: number | null): Promise<SmokeCheck[]> {
  const checks: SmokeCheck[] = [];
  const sorts = [
    { value: "cashback", label: "Maior cashback" },
    { value: "az", label: "A–Z" },
  ];

  for (const sort of sorts) {
    const path = `/?sort=${sort.value}`;
    const result = await checkPage(baseUrl, path, {
      mustNotInclude: ["Não conseguimos carregar as lojas", "O catálogo está temporariamente vazio"],
    });
    checks.push(...result.checks);
    checks.push({
      name: `GET ${path} (controle ativo)`,
      ok: readActiveSortLabel(result.html) === sort.label && extractStoreCardSlugs(result.html).length > 0,
      detail: `ordenação ativa=${JSON.stringify(readActiveSortLabel(result.html))} cards=${extractStoreCardSlugs(result.html).length}`,
    });
    // generateMetadata (src/app/page.tsx:81) promete noindex + canonical próprio para toda
    // ordenação não padrão. É contrato de SEO e sai barato verificar no HTML publicado.
    checks.push({
      name: `GET ${path} (SEO: noindex + canonical)`,
      ok: isNoindex(result.html) && readCanonicalPath(result.html) === path,
      detail: `noindex=${isNoindex(result.html)} canonical=${JSON.stringify(readCanonicalPath(result.html))}`,
    });
    // Invariante de conjunto, não de ordem: mudar a ordenação não pode ganhar nem perder loja.
    // Independente de collation e de classe CSS — ao contrário de asserir ordem alfabética.
    const sortTotalPages = readPaginationTotalPages(result.html);
    checks.push(totalPages === null || sortTotalPages === null
      ? info(`GET ${path} (mesmo total do padrão)`, "paginação ausente em uma das ordenações — total NÃO comparado")
      : {
        name: `GET ${path} (mesmo total do padrão)`,
        ok: sortTotalPages === totalPages,
        detail: `páginas=${sortTotalPages} padrão=${totalPages}`,
      });
  }

  // `sort=platforms` é o padrão e `sort` inválido cai no padrão: ambos vão para o canônico.
  checks.push(await checkCanonicalization(baseUrl, "/?sort=platforms", "/"));
  checks.push(await checkCanonicalization(baseUrl, "/?sort=inexistente", "/"));

  return checks;
}

async function checkSearch(baseUrl: URL): Promise<SmokeCheck[]> {
  const checks: SmokeCheck[] = [];
  const result = await checkPage(baseUrl, "/?q=a", { mustNotInclude: ["Não conseguimos carregar as lojas"] });
  checks.push(...result.checks);
  checks.push({
    name: "GET /?q=a (SEO: noindex + canonical)",
    ok: isNoindex(result.html) && readCanonicalPath(result.html) === "/?q=a",
    detail: `noindex=${isNoindex(result.html)} canonical=${JSON.stringify(readCanonicalPath(result.html))}`,
  });
  // Query não normalizada é canonicalizada antes de renderizar.
  checks.push(await checkCanonicalization(baseUrl, "/?q=%20a%20", "/?q=a"));
  return checks;
}

async function checkActivation(baseUrl: URL, storeSlug: string, platformId: string): Promise<{ checks: SmokeCheck[]; samplesMs: number[] }> {
  const path = `/go/${encodeURIComponent(storeSlug)}/${encodeURIComponent(platformId)}`;
  const samplesMs: number[] = [];
  const checks: SmokeCheck[] = [];

  // 307 ESTRITO. O link veio de uma página de detalhe renderizada com oferta ativa, então o
  // único desfecho correto é o redirect. Aceitar 410/503 aqui — como esta função fazia — deixa
  // um Postgres fora do ar ou um catálogo vencido passarem como sucesso e serem promovidos.
  const evaluate = (label: string, status: number, location: string | null, durationMs: number): SmokeCheck => ({
    name: `GET ${path} (${label})`,
    ok: status === 307 && Boolean(location) && location!.startsWith("https://"),
    detail: `status=${status} destino=${location ? new URL(location).origin : "ausente"} durationMs=${Math.round(durationMs)}`,
  });

  const cold = await timed(() => smokeFetch(new URL(path, baseUrl), { redirect: "manual" }));
  samplesMs.push(cold.durationMs);
  checks.push(evaluate("cold", cold.value.status, cold.value.headers.get("location"), cold.durationMs));

  for (let attempt = 0; attempt < WARM_REQUESTS; attempt += 1) {
    const warm = await timed(() => smokeFetch(new URL(path, baseUrl), { redirect: "manual" }));
    samplesMs.push(warm.durationMs);
    checks.push(evaluate(`warm ${attempt + 1}/${WARM_REQUESTS}`, warm.value.status, warm.value.headers.get("location"), warm.durationMs));
  }

  return { checks, samplesMs };
}

/**
 * 410 é induzível de fora e determinístico: `activation.resolve_destination` é um `select ...
 * limit 1` (migration 20260717000300), então um par forjado devolve zero linhas.
 *
 * 503 NÃO é induzível de fora — exige `resolveActivation` lançar, isto é, o banco de produção
 * fora do ar. Simular seria encenação; é coberto em test/activation.test.ts ("returns a
 * retryable noindex 503"). Aqui a garantia é a inversa: o caminho feliz acima é 307 estrito, e
 * um 503 real reprova o deploy em vez de passar despercebido.
 */
async function checkNegativeRoutes(baseUrl: URL, realStoreSlug: string | null): Promise<SmokeCheck[]> {
  const checks: SmokeCheck[] = [...(await checkStoreNotFound(baseUrl))];

  const forgedTargets = realStoreSlug
    ? [{ slug: realStoreSlug, label: "loja real + plataforma forjada" }, { slug: FORGED_STORE_SLUG, label: "loja forjada" }]
    : [{ slug: FORGED_STORE_SLUG, label: "loja forjada" }];

  for (const target of forgedTargets) {
    const path = `/go/${encodeURIComponent(target.slug)}/${FORGED_PLATFORM_ID}`;
    const response = await smokeFetch(new URL(path, baseUrl), { redirect: "manual" });
    const html = await response.text();
    const robots = response.headers.get("x-robots-tag") ?? "";

    checks.push({
      name: `GET /go/… (${target.label}) → 410`,
      ok: response.status === 410
        && robots.includes("noindex")
        && (response.headers.get("cache-control") ?? "").includes("no-store")
        && html.includes("Esta oferta não está mais disponível"),
      detail: `status=${response.status} x-robots-tag=${JSON.stringify(robots)} cache-control=${JSON.stringify(response.headers.get("cache-control"))}`,
    });
    // A página de erro nunca pode revelar destino de afiliado de outra oferta.
    checks.push({
      name: `GET /go/… (${target.label}) sem destino externo`,
      ok: !/https:\/\/(?!.*(?:localhost|127\.0\.0\.1))[a-z0-9.-]*\.(?:com|br|co)/i.test(html),
      detail: "corpo do 410 sem URL de plataforma",
    });
  }

  return checks;
}

/**
 * Redirect de alias (F3/T12, ADR-0006). Os pares saem do manifesto versionado no Git — sem
 * banco e sem secret novo, porque `stores.slug` é a chave L2 do nome cru.
 *
 * 404 num par declarado NÃO reprova: significa que aquele nome cru nunca materializou uma loja
 * num scrape, o que é fato de curadoria e não regressão de deploy. Uma queda do GRANT em
 * `web_read.store_redirects` faria `getStoreRedirect` lançar e a rota responder 5xx pelo
 * error.tsx — continua distinguível e continua reprovando.
 */
async function checkAliasRedirects(baseUrl: URL): Promise<SmokeCheck[]> {
  const manifest = loadAliasManifest();
  if (!manifest) return [info("redirect de alias", "curation/aliases-manifest.json ilegível a partir do checkout — NÃO verificado")];

  const pairs = aliasRedirectPairs(manifest).slice(0, 5);
  if (pairs.length === 0) {
    return [info("redirect de alias", "nenhum merge de alias declarado no manifesto — redirect NÃO verificado nesta execução")];
  }

  const checks: SmokeCheck[] = [];
  let confirmed = 0;

  for (const pair of pairs) {
    const path = `/loja/${encodeURIComponent(pair.from)}`;
    const expected = `/loja/${encodeURIComponent(pair.to)}`;
    const observation = await observeRedirect(baseUrl, path);

    // Sem redirect E identificada como inexistente: aquele nome cru nunca materializou uma
    // loja num scrape. É fato de curadoria, não regressão — não reprova. Um GRANT derrubado em
    // `web_read.store_redirects` faria `getStoreRedirect` lançar e cair no error.tsx, que não
    // traz este texto, então continua reprovando.
    if (observation.via === null && observation.html.includes("Loja não encontrada")) {
      checks.push(info(`GET ${path} (alias absorvido)`, "o nome cru declarado no manifesto nunca virou loja; par NÃO verificado"));
      continue;
    }

    confirmed += 1;
    checks.push({
      name: `GET ${path} (alias absorvido → canônico)`,
      ok: observation.via !== null && observation.path === expected,
      detail: describeRedirect(observation, expected),
    });
  }

  if (confirmed === 0) {
    checks.push(info("redirect de alias", `${pairs.length} par(es) declarado(s), nenhum materializado em produção — redirect NÃO verificado`));
  }
  return checks;
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

/**
 * `invalidationSecret === null` liga o MODO SOMENTE-LEITURA: nenhum check que grave em produção
 * roda. São exatamente dois, e é bom que estejam nomeados num lugar só —
 *
 * - o bloco de `/go/`, porque cada redirect 307 agenda `recordActivation` via `after()`
 *   (src/app/go/[storeSlug]/[platformId]/route.ts), incrementando `activation_metrics` de uma
 *   loja real: 5 ativações sintéticas por execução, sempre na mesma loja;
 * - o POST de invalidação aceito, que expira a tag `catalog` inteira.
 *
 * Os dois saem como não verificados, nomeando o que ficou de fora. O workflow de publicação
 * sempre passa o segredo e roda tudo — lá os dois efeitos são desejados e o deployment encenado
 * ainda nem recebeu tráfego.
 */
export async function runProductionSmoke(baseUrl: URL, invalidationSecret: string | null): Promise<{ checks: SmokeCheck[]; activationSamplesMs: number[] }> {
  const readOnly = invalidationSecret === null;
  const checks: SmokeCheck[] = [];

  const home = await checkCatalogHome(baseUrl);
  checks.push(...home.checks);
  checks.push(...(await checkEditorialPages(baseUrl)));
  checks.push(...(await checkPagination(baseUrl, home.totalPages)));
  checks.push(...(await checkSorts(baseUrl, home.totalPages)));
  checks.push(...(await checkSearch(baseUrl)));
  checks.push(...(await checkPage(baseUrl, "/robots.txt", { requireRendered: false, mustInclude: ["Disallow: /go/"] })).checks);

  const sitemapResponse = await smokeFetch(new URL("/sitemap.xml", baseUrl));
  const sitemapXml = await sitemapResponse.text();
  checks.push({ name: "GET /sitemap.xml", ok: sitemapResponse.status === 200 && sitemapXml.includes("<urlset"), detail: `status=${sitemapResponse.status}` });

  const sitemapSlugs = extractStoreSlugsFromSitemap(sitemapXml);
  let activationSamplesMs: number[] = [];
  let firstStoreSlug: string | null = null;

  if (sitemapSlugs.length === 0) {
    checks.push({ name: "loja detail + ativação", ok: false, detail: "sitemap.xml não listou nenhuma /loja/<slug>" });
  } else {
    const storeSlugs = storeSample(home.cardSlugs, sitemapSlugs);
    firstStoreSlug = storeSlugs[0]!;
    let found: { storeSlug: string; platformId: string } | null = null;
    let inspectedDetail = false;

    for (const slug of storeSlugs) {
      const detail = await checkPage(baseUrl, `/loja/${encodeURIComponent(slug)}`, {
        mustNotInclude: ["Não conseguimos carregar"],
      });
      checks.push(...detail.checks);

      // O toggle aparece no detalhe só quando a loja tem oferta do Inter (StoreRanking); o
      // primeiro detalhe com link de ativação é a amostra natural para conferir o markup.
      if (!inspectedDetail && readInterSwitchState(detail.html) !== "absent") {
        inspectedDetail = true;
        checks.push({
          name: `GET /loja/${slug} (toggle correntista Inter, padrão ligado)`,
          ok: readInterSwitchState(detail.html) === "on",
          detail: `switch=${readInterSwitchState(detail.html)}`,
        });
      }

      const link = extractActivationLink(detail.html);
      if (link) {
        found = link;
        break;
      }
    }

    if (!inspectedDetail) {
      checks.push(info("toggle correntista no detalhe", "nenhuma das lojas amostradas tinha oferta do Inter — markup do toggle NÃO verificado no detalhe"));
    }

    if (!found) {
      checks.push({ name: "ativação (/go/...)", ok: false, detail: `nenhuma das ${storeSlugs.length} lojas amostradas tinha uma oferta ativa para testar o redirect` });
    } else if (readOnly) {
      checks.push(info(
        `ativação (/go/${found.storeSlug}/${found.platformId})`,
        "modo somente-leitura: redirect NÃO exercitado para não gravar ativações reais em activation_metrics",
      ));
    } else {
      const activation = await checkActivation(baseUrl, found.storeSlug, found.platformId);
      checks.push(...activation.checks);
      activationSamplesMs = activation.samplesMs;
    }
  }

  checks.push(...(await checkNegativeRoutes(baseUrl, firstStoreSlug)));
  checks.push(...(await checkAliasRedirects(baseUrl)));
  checks.push(...(invalidationSecret === null
    ? [info("invalidação do catálogo", "modo somente-leitura: POST assinado NÃO enviado para não expirar o cache do catálogo")]
    : await checkInvalidation(baseUrl, invalidationSecret)));

  return { checks, activationSamplesMs };
}

export function hasSmokeFailure(checks: SmokeCheck[]): boolean {
  return checks.some((check) => !check.ok && !check.informational);
}

export function formatSmokeReport(checks: SmokeCheck[], activationSamplesMs: number[]): string {
  const lines = checks.map((check) => {
    const icon = check.informational ? "ℹ️" : check.ok ? "✅" : "❌";
    return `${icon} [smoke-production] ${check.name} — ${check.detail}`;
  });
  if (activationSamplesMs.length > 0) {
    lines.push(
      `ℹ️ [smoke-production] /go latência: p50=${Math.round(percentile(activationSamplesMs, 50))}ms p95=${Math.round(percentile(activationSamplesMs, 95))}ms (cold + ${activationSamplesMs.length - 1} warm, referência ADR-0032: p95 < 500ms)`,
    );
  }
  const failures = checks.filter((check) => !check.ok && !check.informational).length;
  const skipped = checks.filter((check) => check.informational).length;
  lines.push(`ℹ️ [smoke-production] ${checks.length - failures - skipped} ok · ${failures} falha(s) · ${skipped} não verificado(s)`);
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

  const readOnly = environment.data.FAREJO_SMOKE_READ_ONLY === "1";
  if (readOnly) console.log("[smoke-production] MODO SOMENTE-LEITURA: nenhum check que grave em produção será executado");

  const baseUrl = new URL(environment.data.FAREJO_SITE_URL);
  const { checks, activationSamplesMs } = await runProductionSmoke(baseUrl, readOnly ? null : environment.data.FAREJO_CATALOG_INVALIDATION_SECRET!);
  console.log(formatSmokeReport(checks, activationSamplesMs));
  if (hasSmokeFailure(checks)) process.exitCode = 1;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
