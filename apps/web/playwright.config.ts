import { defineConfig } from "@playwright/test";
import { E2E_BASE_URL, E2E_PORT, E2E_SERVER_ENV } from "./e2e/env";

/**
 * F3/T17: visual/a11y/responsive coverage, separate from test/smoke.mts (functional flows).
 * Projects run in a strict chain so the DB is genuinely empty (fresh `supabase start`, no
 * seed.sql — see CLAUDE.md) when `empty-state` runs, then `seed` inserts fixtures once for
 * every state-bearing project, then `cleanup` removes them.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Um único servidor Next + um único Postgres compartilhado por todo o run (seed/cleanup
  // mutam linhas reais) — múltiplos workers rodando projetos-irmãos em paralelo (ex.: "visual"
  // e "responsive" ao mesmo tempo) competem pelo mesmo processo Node e já causou flakiness
  // observada localmente. Determinismo > paralelismo aqui; o suite inteiro roda em segundos.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" },
  },
  use: {
    baseURL: E2E_BASE_URL,
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec next build && pnpm exec next start --port ${E2E_PORT}`,
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: E2E_SERVER_ENV,
  },
  projects: [
    { name: "empty-state", testMatch: /empty-catalog\.spec\.ts/ },
    { name: "seed", testMatch: /seed\.setup\.ts/, dependencies: ["empty-state"] },
    { name: "visual", testMatch: /visual\.spec\.ts/, dependencies: ["seed"] },
    { name: "responsive", testMatch: /responsive\.spec\.ts/, dependencies: ["seed"] },
    { name: "accessibility", testMatch: /accessibility\.spec\.ts/, dependencies: ["seed"] },
    { name: "cleanup", testMatch: /cleanup\.teardown\.ts/, dependencies: ["visual", "responsive", "accessibility"] },
  ],
});
