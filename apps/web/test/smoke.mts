import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
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

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
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
  await client.query("delete from public.offers where store_id in (select id from public.stores where slug like $1)", [`${fixturePrefix}%`]);
  await client.query("delete from public.stores where slug like $1", [`${fixturePrefix}%`]);
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

await run(pnpm, ["build"]);
const server = spawn(pnpm, ["exec", "next", "start", "--port", String(port)], {
  cwd: process.cwd(),
  shell: process.platform === "win32",
  stdio: "inherit",
});
let browser: import("@playwright/test").Browser | undefined;

try {
  await waitForServer();
  const home = await fetch(baseUrl);
  const homeHtml = await home.text();
  assert.equal(home.status, 200);
  assert.match(homeHtml, /<title>farejô/);
  assert.doesNotMatch(homeHtml, /HANDOFF · ESTADOS DO CATÁLOGO/);
  assert.match(homeHtml, /Loja real sem logo 00/);
  assert.match(homeHtml, /5%/);
  assert.doesNotMatch(homeHtml, /FAREJO_WEB_DATABASE_URL|postgresql:\/\//);
  const clientBundles = [...homeHtml.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]);
  for (const bundlePath of clientBundles) {
    if (!bundlePath) continue;
    const bundle = await fetch(new URL(bundlePath, baseUrl));
    assert.equal(bundle.status, 200);
    assert.doesNotMatch(await bundle.text(), /FAREJO_WEB_DATABASE_URL|postgresql:\/\/|@supabase\/supabase-js/);
  }

  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(baseUrl);
  await page.goto(`${baseUrl}/?page=2`);
  await page.getByText("Loja real sem logo 24").waitFor();
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
