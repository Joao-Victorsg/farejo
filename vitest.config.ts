import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    // apps/web/e2e/*.spec.ts runs under the Playwright Test runner (playwright.config.ts),
    // not vitest — vitest's default *.spec.ts glob would otherwise pick them up and choke on
    // test()/test.describe() called outside Playwright's runner context.
    exclude: [...configDefaults.exclude, "**/e2e/**"],
  },
});
