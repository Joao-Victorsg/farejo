import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { delimiter, dirname } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { Client } from "pg";

const port = 32147;
const baseUrl = `http://127.0.0.1:${port}`;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const fixturePrefix = "issue48-smoke-";
const client = new Client({ connectionString: databaseUrl });
process.env.FAREJO_WEB_DATABASE_URL = databaseUrl;
process.env.FAREJO_ACTIVATION_DATABASE_URL = `${databaseUrl}?options=-c%20role%3Dfarejo_activation`;
process.env.FAREJO_METRICS_DATABASE_URL = `${databaseUrl}?options=-c%20role%3Dfarejo_metrics`;
process.env.FAREJO_CATALOG_INVALIDATION_SECRET = "issue49-smoke-secret-at-least-32-characters";
process.env.VERCEL = "1";
const runtimeEnv = { ...process.env, PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter) };

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: runtimeEnv,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error("Next.js server did not become ready");
}

async function expectHeading(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("heading", { name, level: 1 }).waitFor();
}

async function waitForSwitchState(switchLocator: import("@playwright/test").Locator, expected: "true" | "false") {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await switchLocator.getAttribute("aria-checked")) === expected) return;
    await wait(250);
  }
  throw new Error(`Switch did not reach aria-checked="${expected}"`);
}

async function cleanFixtures() {
  await client.query("delete from public.store_aliases where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.activation_metrics where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.offer_history where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
}

function signedInvalidation(platformId: string, runId: number) {
  const timestamp = String(Date.now());
  const body = JSON.stringify({ platform_id: platformId, run_id: runId, timestamp: Number(timestamp) });
  const signature = createHmac("sha256", process.env.FAREJO_CATALOG_INVALIDATION_SECRET!).update(timestamp).update(body).digest("hex");
  return { body, signature, timestamp };
}

await client.connect();
await cleanFixtures();
for (let index = 0; index < 25; index += 1) {
  const { rows } = await client.query<{ id: number }>(
    "insert into public.stores (slug, name) values ($1, $2) returning id",
    [`${fixturePrefix}${String(index).padStart(2, "0")}`, `Loja real sem logo ${String(index).padStart(2, "0")}`],
  );
  const store = rows[0];
  if (!store) throw new Error("Smoke fixture store was not inserted");
  await client.query(
    "insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at) values ($1, 'inter', 'percent', 5, '5%', 'https://shopping.inter.co/site-parceiro/lojas/issue48', true, now())",
    [store.id],
  );
}

// T18 CI fix: force-dynamic pages stream an implicit `loading.tsx` fallback (never carries
// `id="conteudo"`, see app/loading.tsx) before the real content swaps in within the same
// response. Under CI's CPU contention that swap sometimes isn't done by the time the response
// closes (same race class as 8243f11's skip-link fix, T17), so a bare fetch can observe the
// fallback instead of the rendered page. Every real content branch renders a literal
// `<main id="conteudo"` tag — checked as a rendered tag, not a bare substring, because Next also
// embeds a JSON-escaped preview of the deferred content (`\"id\":\"conteudo\"`, for client
// hydration) inside the shell response's `self.__next_f.push(...)` payload, which would
// otherwise false-positive as "ready" while the visible HTML is still the skeleton.
const RENDERED_MARKER = /<main[^>]* id="conteudo"/;
async function fetchRendered(path: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(new URL(path, baseUrl));
    const html = await response.text();
    if (RENDERED_MARKER.test(html)) return { status: response.status, html };
    await wait(250);
  }
  throw new Error(`Page ${path} never rendered past the loading fallback`);
}

async function waitForPageText(path: string, expected: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(new URL(path, baseUrl));
    const html = await response.text();
    if (response.ok && html.includes(expected)) return html;
    await wait(250);
  }
  throw new Error(`Page ${path} did not render ${expected}`);
}
const { rows: detailStoreRows } = await client.query<{ id: number }>(
  "select id from public.stores where slug = $1",
  [`${fixturePrefix}00`],
);
const detailStore = detailStoreRows[0];
if (!detailStore) throw new Error("Detail fixture store was not inserted");
await client.query(
  "insert into public.offers (store_id, platform_id, reward_type, value, is_upto, raw_text, url, active, last_seen_at) values ($1, 'meliuz', 'percent', 7, true, 'até 7%', 'https://www.meliuz.com.br/desconto/issue48', true, now() - interval '26 hours'), ($1, 'zoom', 'fixed', 30, false, 'R$ 30', 'https://www.zoom.com.br/issue48', true, now())",
  [detailStore.id],
);
const { rows: unavailableStoreRows } = await client.query<{ id: number }>(
  "insert into public.stores (slug, name) values ($1, $2) returning id",
  [`${fixturePrefix}indisponivel`, "Loja real indisponível"],
);
const unavailableStore = unavailableStoreRows[0];
if (!unavailableStore) throw new Error("Unavailable fixture store was not inserted");
await client.query(
  "insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at) values ($1, 'inter', 'percent', 4, '4%', 'https://outside.example.test/inactive', false, now())",
  [unavailableStore.id],
);
const { rows: aliasStores } = await client.query<{ id: number }>(
  "select id from public.stores where slug = $1",
  [`${fixturePrefix}00`],
);
const aliasStore = aliasStores[0];
if (!aliasStore) throw new Error("Alias fixture store was not inserted");
await client.query(
  "insert into public.store_aliases (platform_id, raw_name, store_id) values ('meliuz', 'Nome alternativo da loja', $1)",
  [aliasStore.id],
);
const { rows: toggleStoreRows } = await client.query<{ id: number }>(
  "insert into public.stores (slug, name) values ($1, $2) returning id",
  [`${fixturePrefix}toggle`, "Loja real alterna correntista"],
);
const toggleStore = toggleStoreRows[0];
if (!toggleStore) throw new Error("Toggle fixture store was not inserted");
await client.query(
  `insert into public.offers (store_id, platform_id, reward_type, value, value_partial, raw_text, url, active, last_seen_at) values
    ($1, 'inter', 'percent', 10, 2, '10%', 'https://outside.example.test/inter-toggle', true, now()),
    ($1, 'meliuz', 'percent', 8, null, '8%', 'https://outside.example.test/meliuz-toggle', true, now()),
    ($1, 'cuponomia', 'percent', 6, null, '6%', 'https://outside.example.test/cuponomia-toggle', true, now()),
    ($1, 'zoom', 'percent', 4, null, '4%', 'https://outside.example.test/zoom-toggle', true, now())`,
  [toggleStore.id],
);
// Issue54: histórico real — correntista Inter e Méliuz têm uma mudança real (sufficient);
// o não correntista Inter só tem uma leitura de value_partial (2), sem mudança — o toggle
// para "não correntista" precisa mostrar "sendo construído" para o Inter em vez de cair
// para a série de correntista.
await client.query(
  `insert into public.offer_history (store_id, platform_id, reward_type, value, value_partial, changed_at) values
    ($1, 'inter', 'percent', 8, 2, now() - interval '10 days'),
    ($1, 'inter', 'percent', 10, 2, now() - interval '2 days'),
    ($1, 'meliuz', 'percent', 6, null, now() - interval '10 days'),
    ($1, 'meliuz', 'percent', 8, null, now() - interval '2 days')`,
  [toggleStore.id],
);

await run(pnpm, ["build"]);
const server = spawn(pnpm, ["exec", "next", "start", "--port", String(port)], {
  cwd: process.cwd(),
  env: runtimeEnv,
  shell: process.platform === "win32",
  stdio: "inherit",
});
let browser: import("@playwright/test").Browser | undefined;

try {
  await waitForServer();
  const initialEvent = signedInvalidation("inter", 50);
  const initialInvalidation = await fetch(`${baseUrl}/api/internal/catalog-invalidation`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-proto": "https",
      "x-farejo-timestamp": initialEvent.timestamp,
      "x-farejo-signature": initialEvent.signature,
    },
    body: initialEvent.body,
  });
  assert.equal(initialInvalidation.status, 204);
  const homeHtml = await waitForPageText("/", "Loja real sem logo 00");
  assert.match(homeHtml, /<title>farejô/);
  assert.doesNotMatch(homeHtml, /HANDOFF · ESTADOS DO CATÁLOGO/);
  assert.match(homeHtml, /Loja real sem logo 00/);
  assert.match(homeHtml, /5%/);
  assert.match(homeHtml, new RegExp(`href="/loja/${fixturePrefix}00"`));
  assert.doesNotMatch(homeHtml, /FAREJO_WEB_DATABASE_URL|FAREJO_CATALOG_INVALIDATION_SECRET|postgresql:\/\//);
  const clientBundles = [...homeHtml.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]);
  for (const bundlePath of clientBundles) {
    if (!bundlePath) continue;
    const bundle = await fetch(new URL(bundlePath, baseUrl));
    assert.equal(bundle.status, 200);
    assert.doesNotMatch(await bundle.text(), /FAREJO_WEB_DATABASE_URL|FAREJO_CATALOG_INVALIDATION_SECRET|postgresql:\/\/|@supabase\/supabase-js/);
  }

  // Issue56: `/plataformas` lê o mesmo web_read via getPlatformStats(). mycashback nunca
  // recebe oferta nas fixtures acima, então cobre o estado "sem lojas elegíveis" de uma
  // plataforma isolada (distinto da anomalia de todas zeradas).
  const { html: platformsHtml } = await fetchRendered("/plataformas");
  assert.match(platformsHtml, /<h1[^>]*>Plataformas de cashback<\/h1>/);
  assert.match(platformsHtml, /Méliuz/);
  assert.match(platformsHtml, /Cuponomia/);
  assert.match(platformsHtml, /MyCashback/);
  assert.match(platformsHtml, /Zoom/);
  assert.match(platformsHtml, /Shopping Inter/);
  assert.match(platformsHtml, /em \d+ lojas/);
  assert.match(platformsHtml, /Ainda sem lojas elegíveis/);
  assert.match(platformsHtml, /PARA CORRENTISTAS/);
  assert.match(platformsHtml, /média por loja/);
  assert.match(platformsHtml, /pico anunciado/);
  assert.doesNotMatch(platformsHtml, /FAREJO_WEB_DATABASE_URL|FAREJO_CATALOG_INVALIDATION_SECRET|postgresql:\/\//);

  const pageOne = await (await fetch(`${baseUrl}/?page=1`)).text();
  assert.match(pageOne, /http-equiv="refresh" content="1;url=\/"/);
  const explicitDefaultSort = await (await fetch(`${baseUrl}/?sort=platforms`)).text();
  assert.match(explicitDefaultSort, /http-equiv="refresh" content="1;url=\/"/);
  const { html: indexedSecondPage } = await fetchRendered("/?page=2");
  assert.match(indexedSecondPage, /<link rel="canonical" href="https:\/\/farejo\.com\.br\/\?page=2"/);
  assert.doesNotMatch(indexedSecondPage, /name="robots" content="noindex, follow"/);
  const { html: outOfRangePage } = await fetchRendered("/?page=999");
  assert.match(outOfRangePage, /Esta página não existe/);
  assert.match(outOfRangePage, /name="robots" content="noindex, follow"/);
  for (const repeatedParameterUrl of ["?q=loja&q=outra", "?sort=az&sort=cashback", "?page=1&page=2"]) {
    const repeatedParameter = await (await fetch(`${baseUrl}/${repeatedParameterUrl}`)).text();
    assert.match(repeatedParameter, /Esta página não existe/);
    assert.match(repeatedParameter, /name="robots" content="noindex, follow"/);
  }
  const { html: searchPage } = await fetchRendered("/?q=Nome+alternativo+da+loja");
  assert.match(searchPage, /Loja real sem logo 00/);
  assert.match(searchPage, /name="robots" content="noindex, follow"/);
  const sitemap = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
  assert.match(sitemap, /https:\/\/farejo\.com\.br\/\?page=2/);
  assert.match(sitemap, new RegExp(`https://farejo\\.com\\.br/loja/${fixturePrefix}00`));
  assert.doesNotMatch(sitemap, new RegExp(`${fixturePrefix}indisponivel`));
  const robots = await (await fetch(`${baseUrl}/robots.txt`)).text();
  assert.match(robots, /Disallow: \/go\//);

  const { status: detailStatus, html: detailHtml } = await fetchRendered(`/loja/${fixturePrefix}00`);
  assert.equal(detailStatus, 200);
  assert.match(detailHtml, /<h1[^>]*>Loja real sem logo 00<\/h1>/);
  assert.match(detailHtml, new RegExp(`<link rel="canonical" href="https://farejo\\.com\\.br/loja/${fixturePrefix}00"`));
  assert.ok(detailHtml.indexOf("Até 7%") < detailHtml.indexOf("5%"));
  assert.ok(detailHtml.indexOf("5%") < detailHtml.indexOf("R$ 30"));
  assert.match(detailHtml, /Teto anunciado pela plataforma/);
  assert.match(detailHtml, new RegExp(`href="/go/${fixturePrefix}00/inter"`));
  assert.match(detailHtml, /target="_blank"/);
  assert.match(detailHtml, /rel="noopener noreferrer"/);
  assert.doesNotMatch(detailHtml, /https:\/\/(shopping\.inter\.co|www\.meliuz\.com\.br|www\.zoom\.com\.br)/);
  assert.match(detailHtml, /Histórico de cashback/);
  assert.match(detailHtml, /HISTÓRICO SENDO CONSTRUÍDO/);
  assert.match(detailHtml, /Ainda não observamos mudanças suficientes/);

  // Renderização inicial do servidor assume correntista=true (ADR-0034/ADR-0046) — a
  // modalidade não correntista só aparece depois do toggle no cliente (coberto abaixo, via
  // Playwright, junto com a troca real de estado).
  const toggleDetailHtml = await waitForPageText(`/loja/${fixturePrefix}toggle`, "Shopping Inter (correntista): variou entre 8% e 10%");
  assert.doesNotMatch(toggleDetailHtml, /HISTÓRICO SENDO CONSTRUÍDO/);
  assert.match(toggleDetailHtml, /Méliuz: variou entre 6% e 8%/);
  assert.doesNotMatch(toggleDetailHtml, /não correntista/);

  const activationStartedAt = performance.now();
  const activation = await fetch(`${baseUrl}/go/${fixturePrefix}00/inter`, { redirect: "manual" });
  assert.equal(activation.status, 307);
  assert.equal(activation.headers.get("location"), "https://shopping.inter.co/site-parceiro/lojas/issue48");
  assert.ok(performance.now() - activationStartedAt < 1_500, "cold activation must respect the total timeout");
  const warmDurations: number[] = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const startedAt = performance.now();
    const warmActivation = await fetch(`${baseUrl}/go/${fixturePrefix}00/inter`, { redirect: "manual" });
    assert.equal(warmActivation.status, 307);
    warmDurations.push(performance.now() - startedAt);
  }
  warmDurations.sort((left, right) => left - right);
  const p95 = warmDurations[Math.ceil(warmDurations.length * 0.95) - 1];
  assert.ok(p95 !== undefined && p95 < 500, `warm activation p95 was ${String(p95)}ms`);
  const inactiveActivation = await fetch(`${baseUrl}/go/${fixturePrefix}indisponivel/inter`, { redirect: "manual" });
  assert.equal(inactiveActivation.status, 410);
  assert.match(await inactiveActivation.text(), /Esta oferta não está mais disponível/);
  const forgedActivation = await fetch(`${baseUrl}/go/${fixturePrefix}forjada/portal-forjado`, { redirect: "manual" });
  assert.equal(forgedActivation.status, 410);
  assert.doesNotMatch(await forgedActivation.text(), /shopping\.inter\.co/);

  const unavailable = await fetch(`${baseUrl}/loja/${fixturePrefix}indisponivel`);
  const unavailableHtml = await unavailable.text();
  assert.equal(unavailable.status, 200);
  assert.match(unavailableHtml, /Nenhum cashback disponível no momento/);
  assert.match(unavailableHtml, /name="robots" content="noindex, follow"/);
  assert.doesNotMatch(unavailableHtml, />Ativar</);

  const missing = await fetch(`${baseUrl}/loja/${fixturePrefix}inexistente`);
  const missingHtml = await missing.text();
  // App Router streams this route, so Next keeps the already-sent HTTP 200 while
  // notFound() renders the 404 UI and injects noindex metadata.
  assert.match(missingHtml, /Loja não encontrada/);
  assert.match(missingHtml, /name="robots" content="noindex"/);

  await client.query(
    "update public.offers set value = 7, raw_text = '7%', updated_at = now() where store_id = (select id from public.stores where slug = $1) and platform_id = 'inter'",
    [`${fixturePrefix}00`],
  );
  const event = signedInvalidation("inter", 49);
  const invalidation = await fetch(`${baseUrl}/api/internal/catalog-invalidation`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-proto": "https",
      "x-farejo-timestamp": event.timestamp,
      "x-farejo-signature": event.signature,
    },
    body: event.body,
  });
  assert.equal(invalidation.status, 204);
  const rebuiltHome = await (await fetch(baseUrl)).text();
  assert.match(rebuiltHome, /7%/);

  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(baseUrl);
  await page.getByRole("link", { name: "Ver ofertas de Loja real sem logo 00" }).click();
  await page.waitForURL(`${baseUrl}/loja/${fixturePrefix}00`);
  await expectHeading(page, "Loja real sem logo 00");
  await page.context().route("https://shopping.inter.co/**", (route) => route.fulfill({ body: "Ativação redirecionada" }));
  const [activationTab] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("link", { name: "Ativar cashback pela Shopping Inter (abre em nova aba)" }).click(),
  ]);
  await activationTab.waitForLoadState();
  await activationTab.close();
  await page.goto(`${baseUrl}/loja/${fixturePrefix}01`);
  await expectHeading(page, "Loja real sem logo 01");
  await page.getByText("1 plataforma com cashback").waitFor();
  await page.goto(`${baseUrl}/?page=2`);
  await page.getByText("Loja real sem logo 24").waitFor();
  await page.goto(baseUrl);
  await page.locator("#catalog-search").fill("Nome alternativo da loja");
  await page.waitForURL(/\?q=Nome\+alternativo\+da\+loja$/);
  await page.getByText("Loja real sem logo 00").waitFor();
  await page.locator("#catalog-sort").selectOption("cashback");
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.waitForURL(/\?q=Nome\+alternativo\+da\+loja&sort=cashback$/);

  await page.goto(baseUrl);
  const interSwitch = page.getByRole("switch", { name: "Sou correntista Inter" });
  await interSwitch.waitFor();
  assert.equal(await interSwitch.getAttribute("aria-checked"), "true");
  const toggleCardLink = page.getByRole("link", { name: "Ver ofertas de Loja real alterna correntista" });
  const toggleCard = page.locator("article", { has: toggleCardLink });
  await toggleCard.waitFor();
  let toggleCardText = await toggleCard.innerText();
  assert.match(toggleCardText, /Shopping Inter/);
  assert.match(toggleCardText, /MELHOR/);
  assert.doesNotMatch(toggleCardText, /Zoom/);
  assert.match(toggleCardText, /\+1 outra plataforma/);
  assert.ok(toggleCardText.indexOf("Shopping Inter") < toggleCardText.indexOf("Méliuz"));
  const unaffectedCardTextBeforeToggle = await page.locator("article", { has: page.getByRole("link", { name: "Ver ofertas de Loja real sem logo 01" }) }).innerText();
  assert.match(unaffectedCardTextBeforeToggle, /5%/);

  await interSwitch.click();
  await waitForSwitchState(interSwitch, "false");
  toggleCardText = await toggleCard.innerText();
  assert.match(toggleCardText, /Méliuz/);
  assert.match(toggleCardText, /MELHOR/);
  assert.doesNotMatch(toggleCardText, /Shopping Inter/);
  assert.match(toggleCardText, /\+1 outra plataforma/);
  assert.ok(toggleCardText.indexOf("Méliuz") < toggleCardText.indexOf("Cuponomia"));
  assert.ok(toggleCardText.indexOf("Cuponomia") < toggleCardText.indexOf("Zoom"));
  const unaffectedCardTextAfterToggle = await page.locator("article", { has: page.getByRole("link", { name: "Ver ofertas de Loja real sem logo 01" }) }).innerText();
  assert.equal(unaffectedCardTextBeforeToggle, unaffectedCardTextAfterToggle);

  await page.reload();
  await interSwitch.waitFor();
  assert.equal(await interSwitch.getAttribute("aria-checked"), "false");
  toggleCardText = await toggleCard.innerText();
  assert.match(toggleCardText, /Méliuz/);
  assert.doesNotMatch(toggleCardText, /Shopping Inter/);

  await toggleCardLink.click();
  await page.waitForURL(`${baseUrl}/loja/${fixturePrefix}toggle`);
  await expectHeading(page, "Loja real alterna correntista");
  const detailSwitch = page.getByRole("switch", { name: "Sou correntista Inter" });
  await detailSwitch.waitFor();
  assert.equal(await detailSwitch.getAttribute("aria-checked"), "false");
  const rankingItems = page.locator(`ol[aria-label="Ranking de cashback de Loja real alterna correntista"] li`);
  let firstItemText = await rankingItems.first().innerText();
  assert.match(firstItemText, /Méliuz/);
  assert.match(firstItemText, /MELHOR/);
  let interRowText = await rankingItems.filter({ hasText: "Shopping Inter" }).innerText();
  assert.match(interRowText, /TAXA NÃO CORRENTISTA/);
  assert.match(interRowText, /2%/);

  // Issue54: o histórico segue o toggle — a modalidade não correntista do Inter não tem
  // mudança real (só uma leitura de value_partial) e nunca cai para a série correntista.
  const historySection = page.getByRole("region", { name: "Histórico de cashback" });
  let historyText = await historySection.innerText();
  assert.match(historyText, /Shopping Inter \(não correntista\): histórico sendo construído\./);
  assert.doesNotMatch(historyText, /Shopping Inter \(correntista\): variou/);
  assert.match(historyText, /Méliuz: variou entre 6% e 8%/);

  await detailSwitch.click();
  await waitForSwitchState(detailSwitch, "true");
  firstItemText = await rankingItems.first().innerText();
  assert.match(firstItemText, /Shopping Inter/);
  assert.match(firstItemText, /MELHOR/);
  interRowText = await rankingItems.filter({ hasText: "Shopping Inter" }).innerText();
  assert.match(interRowText, /TAXA CORRENTISTA/);
  assert.doesNotMatch(interRowText, /NÃO CORRENTISTA/);
  assert.match(interRowText, /10%/);

  historyText = await historySection.innerText();
  assert.match(historyText, /Shopping Inter \(correntista\): variou entre 8% e 10%/);
  assert.doesNotMatch(historyText, /Shopping Inter \(não correntista\): variou/);

  await page.getByRole("link", { name: "Voltar para todas as lojas" }).click();
  await page.waitForURL(`${baseUrl}/#catalogo`);
  await interSwitch.waitFor();
  assert.equal(await interSwitch.getAttribute("aria-checked"), "true");
  toggleCardText = await toggleCard.innerText();
  assert.match(toggleCardText, /Shopping Inter/);
  assert.match(toggleCardText, /MELHOR/);

  const freshContext = await browser.newContext();
  try {
    const freshPage = await freshContext.newPage();
    await freshPage.goto(baseUrl);
    const freshSwitch = freshPage.getByRole("switch", { name: "Sou correntista Inter" });
    await freshSwitch.waitFor();
    assert.equal(await freshSwitch.getAttribute("aria-checked"), "true");
    const freshCardText = await freshPage.locator("article", { has: freshPage.getByRole("link", { name: "Ver ofertas de Loja real alterna correntista" }) }).innerText();
    assert.match(freshCardText, /Shopping Inter/);
    assert.match(freshCardText, /MELHOR/);
  } finally {
    await freshContext.close();
  }

  await page.goto(baseUrl);
  // Mesma corrida do skeleton em loading.tsx que 8243f11 corrigiu nos specs e2e (T17): o skip
  // link existe tanto no skeleton quanto no conteúdo real, mas só o conteúdo real tem
  // id="conteudo" como alvo — sem esperar por ele, o foco pode não ir para lugar nenhum.
  await page.locator("#catalog-search").waitFor();
  await page.getByRole("link", { name: "Pular para o conteúdo" }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "conteudo");
  const navigation = page.getByRole("navigation", { name: "Navegação principal" });
  await navigation.getByRole("link", { name: "Como funciona" }).click();
  await page.waitForURL(`${baseUrl}/como-funciona`);
  await expectHeading(page, "Como o farejô funciona");
  await navigation.getByRole("link", { name: "FAQ" }).click();
  await page.waitForURL(`${baseUrl}/faq`);
  await expectHeading(page, "Perguntas frequentes");
} finally {
  await browser?.close();
  if (server.exitCode === null && server.pid) {
    if (process.platform === "win32") {
      await run("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
    } else {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
  }
  await cleanFixtures();
  await client.end();
}
