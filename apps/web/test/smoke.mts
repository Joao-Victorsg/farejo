import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
import { chromium } from "@playwright/test";

const port = 32147;
const baseUrl = `http://127.0.0.1:${port}`;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

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

  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(baseUrl);
  const navigation = page.getByRole("navigation", { name: "Navegação principal" });
  await navigation.getByRole("link", { name: "Como funciona" }).click();
  await page.waitForURL(`${baseUrl}/como-funciona`);
  await expectHeading(page, "Como o farejô funciona");
  await navigation.getByRole("link", { name: "FAQ" }).click();
  await page.waitForURL(`${baseUrl}/faq`);
  await expectHeading(page, "Perguntas frequentes");
  await page.getByRole("link", { name: "Pular para o conteúdo" }).click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "conteudo");
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
}
