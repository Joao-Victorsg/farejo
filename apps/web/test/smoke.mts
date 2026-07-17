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

async function cleanFixtures() {
  await client.query("delete from public.store_aliases where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
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
    "insert into public.offers (store_id, platform_id, reward_type, value, raw_text, url, active, last_seen_at) values ($1, 'inter', 'percent', 5, '5%', 'https://example.test/inter', true, now())",
    [store.id],
  );
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
  "insert into public.offers (store_id, platform_id, reward_type, value, is_upto, raw_text, url, active, last_seen_at) values ($1, 'meliuz', 'percent', 7, true, 'até 7%', 'https://outside.example.test/meliuz', true, now() - interval '26 hours'), ($1, 'zoom', 'fixed', 30, false, 'R$ 30', 'https://outside.example.test/zoom', true, now())",
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

  const pageOne = await (await fetch(`${baseUrl}/?page=1`)).text();
  assert.match(pageOne, /http-equiv="refresh" content="1;url=\/"/);
  const explicitDefaultSort = await (await fetch(`${baseUrl}/?sort=platforms`)).text();
  assert.match(explicitDefaultSort, /http-equiv="refresh" content="1;url=\/"/);
  const indexedSecondPage = await (await fetch(`${baseUrl}/?page=2`)).text();
  assert.match(indexedSecondPage, /<link rel="canonical" href="https:\/\/farejo\.com\.br\/\?page=2"/);
  assert.doesNotMatch(indexedSecondPage, /name="robots" content="noindex, follow"/);
  const outOfRangePage = await (await fetch(`${baseUrl}/?page=999`)).text();
  assert.match(outOfRangePage, /Esta página não existe/);
  assert.match(outOfRangePage, /name="robots" content="noindex, follow"/);
  for (const repeatedParameterUrl of ["?q=loja&q=outra", "?sort=az&sort=cashback", "?page=1&page=2"]) {
    const repeatedParameter = await (await fetch(`${baseUrl}/${repeatedParameterUrl}`)).text();
    assert.match(repeatedParameter, /Esta página não existe/);
    assert.match(repeatedParameter, /name="robots" content="noindex, follow"/);
  }
  const searchPage = await (await fetch(`${baseUrl}/?q=Nome+alternativo+da+loja`)).text();
  assert.match(searchPage, /Loja real sem logo 00/);
  assert.match(searchPage, /name="robots" content="noindex, follow"/);
  const sitemap = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
  assert.match(sitemap, /https:\/\/farejo\.com\.br\/\?page=2/);
  assert.match(sitemap, new RegExp(`https://farejo\\.com\\.br/loja/${fixturePrefix}00`));
  assert.doesNotMatch(sitemap, new RegExp(`${fixturePrefix}indisponivel`));
  const robots = await (await fetch(`${baseUrl}/robots.txt`)).text();
  assert.match(robots, /Disallow: \/go\//);

  const detail = await fetch(`${baseUrl}/loja/${fixturePrefix}00`);
  const detailHtml = await detail.text();
  assert.equal(detail.status, 200);
  assert.match(detailHtml, /<h1[^>]*>Loja real sem logo 00<\/h1>/);
  assert.match(detailHtml, new RegExp(`<link rel="canonical" href="https://farejo\\.com\\.br/loja/${fixturePrefix}00"`));
  assert.ok(detailHtml.indexOf("Até 7%") < detailHtml.indexOf("5%"));
  assert.ok(detailHtml.indexOf("5%") < detailHtml.indexOf("R$ 30"));
  assert.match(detailHtml, /Teto anunciado pela plataforma/);
  assert.doesNotMatch(detailHtml, /https:\/\/outside\.example\.test/);

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
