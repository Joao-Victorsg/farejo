import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import {
  extractStoreCardSlugs,
  extractStoreSlugsFromSitemap,
  formatSmokeReport,
  hasSmokeFailure,
  protectionBypassHeaders,
  readInterSwitchState,
  storeSample,
  type SmokeCheck,
} from "./smoke-production.mjs";

/**
 * Complemento de browser ao smoke de produção (test/smoke-production.mts), separado de propósito:
 * aquele arquivo só fala HTTP e prova roteamento, status e markup servido; este sobe um Chromium
 * de verdade contra o MESMO artefato publicado e prova a única coisa que HTTP não alcança — que o
 * bundle publicado HIDRATA.
 *
 * Por que isso precisa de produção, e não basta o smoke local com browser (test/smoke.mts): o
 * toggle de correntista é cliente puro (`localStorage`, src/lib/inter-preference.tsx), então o SSR
 * sempre entrega o padrão ligado e o HTML servido é idêntico com ou sem JavaScript funcionando. O
 * risco específico do artefato publicado é de hidratação — chunk 404 no CDN, bundle divergente do
 * que foi testado, CSP bloqueando script — e nenhum teste local o reproduz.
 *
 * A asserção central é deliberadamente a interação: se o React não hidratou, o `onClick` nunca
 * dispara e `aria-checked` nunca muda. Erros de console entram só como diagnóstico, nunca como
 * reprovação — script de terceiro (Analytics/Speed Insights) falhando num deployment encenado não
 * é regressão do produto, e transformá-lo em falha encheria o caminho de publicação de alarme
 * falso.
 */

const BrowserSmokeEnvironment = z.object({
  FAREJO_SITE_URL: z.string().url(),
  VERCEL_AUTOMATION_BYPASS_SECRET: z.string().min(1).optional(),
});

const FETCH_TIMEOUT_MS = 10_000;
const SWITCH_STATE_TIMEOUT_MS = 10_000;
const CLICK_RETRY_INTERVAL_MS = 1_000;
const INTER_SWITCH = 'button[aria-label="Sou correntista Inter"]';

/**
 * Primeira loja amostrada cujo detalhe traz o toggle. A presença do switch JÁ é o sinal de que a
 * loja tem oferta do Inter com taxa não-correntista: `StoreRanking` só o renderiza quando
 * `offers.some(isInterCorrentistaOffer)` (src/components/store-ranking.tsx:32). Não é preciso
 * inferir nada do texto renderizado.
 *
 * A amostra vem de `storeSample` — home (ordenada por cobertura) + sitemap (alfabético). Amostrar
 * só o sitemap fazia este arquivo inteiro degradar para "não verificado" contra a produção real,
 * porque a cauda longa que abre o alfabeto não tem oferta do Inter; ver a medição em storeSample.
 */
async function findStoreWithInterToggle(
  baseUrl: URL,
  headers: Record<string, string>,
): Promise<{ slug: string; sampled: number } | null> {
  const fetchText = async (path: string) => {
    const response = await fetch(new URL(path, baseUrl), { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return response.text();
  };

  const slugs = storeSample(
    [...new Set(extractStoreCardSlugs(await fetchText("/")))],
    extractStoreSlugsFromSitemap(await fetchText("/sitemap.xml")),
  );

  for (const slug of slugs) {
    if (readInterSwitchState(await fetchText(`/loja/${encodeURIComponent(slug)}`)) !== "absent") {
      return { slug, sampled: slugs.length };
    }
  }
  return null;
}

async function waitForSwitchState(page: Page, expected: "true" | "false", timeoutMs: number = SWITCH_STATE_TIMEOUT_MS): Promise<boolean> {
  try {
    await page.waitForFunction(
      ([selector, want]) => document.querySelector(selector!)?.getAttribute("aria-checked") === want,
      [INTER_SWITCH, expected] as const,
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * MEDIDO CONTRA PRODUÇÃO (23/07/2026): `switchLocator.waitFor()` confirma só que o nó existe no
 * DOM — não que o React já anexou o `onClick`. A folga entre os dois é normalmente pequena
 * demais para um clique real cair nela, mas caiu em duas execuções seguidas do deploy real
 * (mesmo build que tinha passado 4/4 horas antes). Reproduzido e isolado: uma interação manual
 * — com a latência natural de várias chamadas entre carregar a página e clicar — sempre pegou o
 * estado já hidratado; rodar o script sozinho, sem essa folga, falhou 2x e depois passou 3x
 * seguidas contra o mesmo build. É corrida de hidratação no clique automatizado, não bug do
 * produto nem flake de CI.
 *
 * Reclica dentro do mesmo orçamento (SWITCH_STATE_TIMEOUT_MS) em vez de esperar passivamente uma
 * vez. Confere o estado ANTES de cada clique — nunca clica se já está no valor esperado — porque
 * o switch é toggle, não set: reclicar um clique que na verdade já tinha funcionado inverteria de
 * novo. Se o bundle nunca hidratar dentro da janela inteira, todas as tentativas falham e o check
 * reprova do mesmo jeito.
 */
async function clickUntilSwitchState(page: Page, switchLocator: Locator, expected: "true" | "false"): Promise<boolean> {
  const deadline = Date.now() + SWITCH_STATE_TIMEOUT_MS;
  do {
    if ((await switchLocator.getAttribute("aria-checked")) === expected) return true;
    await switchLocator.click();
    await waitForSwitchState(page, expected, CLICK_RETRY_INTERVAL_MS);
  } while (Date.now() < deadline);
  return (await switchLocator.getAttribute("aria-checked")) === expected;
}

async function rankingText(page: Page): Promise<string> {
  return page.locator('ol[aria-label^="Ranking de cashback de"]').innerText();
}

export async function runBrowserSmoke(baseUrl: URL, bypassSecret: string | undefined): Promise<SmokeCheck[]> {
  const headers = protectionBypassHeaders(bypassSecret);
  const checks: SmokeCheck[] = [];

  const target = await findStoreWithInterToggle(baseUrl, headers);
  if (!target) {
    return [{
      name: "toggle correntista (hidratação)",
      ok: true,
      informational: true,
      detail: "nenhuma loja amostrada (home + sitemap) tinha oferta do Inter com taxa não-correntista — hidratação NÃO verificada nesta execução",
    }];
  }

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ extraHTTPHeaders: headers });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const storePath = `/loja/${encodeURIComponent(target.slug)}`;
    await page.goto(new URL(storePath, baseUrl).toString(), { waitUntil: "domcontentloaded" });

    const switchLocator = page.locator(INTER_SWITCH);
    await switchLocator.waitFor({ timeout: SWITCH_STATE_TIMEOUT_MS });
    checks.push({
      name: `GET ${storePath} (toggle no ar, padrão ligado)`,
      ok: (await switchLocator.getAttribute("aria-checked")) === "true",
      detail: `aria-checked=${await switchLocator.getAttribute("aria-checked")} loja amostrada=${target.slug}`,
    });

    const before = await rankingText(page);

    // Núcleo do teste: o clique só produz efeito se o bundle publicado hidratou.
    const flipped = await clickUntilSwitchState(page, switchLocator, "false");
    checks.push({
      name: `${storePath} (bundle publicado hidrata: o clique altera o estado)`,
      ok: flipped,
      detail: flipped
        ? "aria-checked passou a false após o clique"
        : `o switch não reagiu ao clique em ${SWITCH_STATE_TIMEOUT_MS}ms (com retentativas) — bundle publicado provavelmente não hidratou`,
    });

    // Reordenação é regra de domínio já coberta em offer-ranking.test.ts; aqui a pergunta é só se
    // a preferência chega até a superfície renderizada no artefato publicado.
    const after = await rankingText(page);
    checks.push({
      name: `${storePath} (ranking reflete a preferência)`,
      ok: flipped && after !== before,
      detail: flipped
        ? after === before ? "o ranking não mudou ao desligar o correntista" : "o ranking mudou ao desligar o correntista"
        : "não avaliado: o switch não reagiu ao clique",
    });

    // Persistência é a segunda metade da ADR-0034: a escolha sobrevive à navegação.
    await page.reload({ waitUntil: "domcontentloaded" });
    await switchLocator.waitFor({ timeout: SWITCH_STATE_TIMEOUT_MS });
    const persisted = await waitForSwitchState(page, "false");
    checks.push({
      name: `${storePath} (preferência persiste após recarregar)`,
      ok: flipped && persisted,
      detail: flipped
        ? persisted ? "aria-checked continua false depois do reload" : "a preferência não sobreviveu ao reload"
        : "não avaliado: o switch não reagiu ao clique",
    });

    if (pageErrors.length > 0) {
      checks.push({
        name: `${storePath} (erros de console)`,
        ok: true,
        informational: true,
        detail: `${pageErrors.length} erro(s) na página, diagnóstico apenas: ${JSON.stringify(pageErrors.slice(0, 3))}`,
      });
    }
  } finally {
    await browser?.close();
  }

  return checks;
}

async function main(): Promise<void> {
  const environment = BrowserSmokeEnvironment.safeParse(process.env);
  if (!environment.success) {
    console.error("[smoke-production-browser] FAREJO_SITE_URL ausente; não é possível rodar o smoke de browser");
    process.exitCode = 1;
    return;
  }

  const checks = await runBrowserSmoke(new URL(environment.data.FAREJO_SITE_URL), environment.data.VERCEL_AUTOMATION_BYPASS_SECRET);
  console.log(formatSmokeReport(checks, []).replaceAll("[smoke-production]", "[smoke-production-browser]"));
  if (hasSmokeFailure(checks)) process.exitCode = 1;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
