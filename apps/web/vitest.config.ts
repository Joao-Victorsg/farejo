import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e/*.spec.ts runs under the Playwright Test runner (playwright.config.ts), not vitest.
    // The root vitest.config.ts's `exclude` doesn't propagate to glob-discovered workspace
    // projects, so this needs to live here too.
    exclude: [...configDefaults.exclude, "**/e2e/**"],
  },
});
