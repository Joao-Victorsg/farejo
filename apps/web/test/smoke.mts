import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
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
process.env.FAREJO_CATALOG_INVALIDATION_SECRET = "issue49-smoke-secret-at-least-32-characters";
process.env.VERCEL = "1";

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
  assert.doesNotMatch(homeHtml, /FAREJO_WEB_DATABASE_URL|FAREJO_CATALOG_INVALIDATION_SECRET|postgresql:\/\//);
  const clientBundles = [...homeHtml.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]);
  for (const bundlePath of clientBundles) {
    if (!bundlePath) continue;
    const bundle = await fetch(new URL(bundlePath, baseUrl));
    assert.equal(bundle.status, 200);
    assert.doesNotMatch(await bundle.text(), /FAREJO_WEB_DATABASE_URL|FAREJO_CATALOG_INVALIDATION_SECRET|postgresql:\/\/|@supabase\/supabase-js/);
  }

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
