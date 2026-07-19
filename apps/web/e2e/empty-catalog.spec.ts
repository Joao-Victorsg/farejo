import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { truncateCatalog, withDb } from "./db";
import { invalidateCatalog } from "./invalidate";

/**
 * Roda antes do projeto "seed". Trunca `public.stores` (cascata cobre offers/offer_history/
 * store_aliases/activation_metrics) para garantir o estado "catálogo sem lojas elegíveis por
 * anomalia" (`catalog.total === 0` sem busca) de forma determinística — ver db.ts para por que
 * não dá pra confiar que o catálogo já está vazio neste ponto da cadeia `pnpm test`.
 */
test.describe.configure({ mode: "serial" });

test("catálogo anomalamente vazio é visualmente distinto e sem bloqueadores de acessibilidade", async ({ page }) => {
  await withDb(truncateCatalog);
  await invalidateCatalog();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "O catálogo está temporariamente vazio." })).toBeVisible();
  await expect(page).toHaveScreenshot("home-catalog-anomalous-empty.png", { fullPage: true });

  const results = await new AxeBuilder({ page }).include("main").analyze();
  expect(results.violations).toEqual([]);
});
