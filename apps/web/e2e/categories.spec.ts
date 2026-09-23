import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixtureSlug, withDb } from "./db";
import { invalidateCatalog } from "./invalidate";

test.beforeAll(async () => {
  await withDb(async (db) => {
    await db.query("insert into public.categories (slug, name, icon, position) values ('e2e-moda', 'Moda e acessórios', 'shirt', 1), ('e2e-pets', 'Pets', 'paw-print', 2)");
    await db.query("insert into public.store_categories (store_id, category_slug, evidence) select id, 'e2e-moda', '[{\"url\":\"https://example.test/moda\"}]' from public.stores where slug = $1", [fixtureSlug("alpha")]);
  });
  await invalidateCatalog();
});
test.afterAll(async () => {
  await withDb(async (db) => {
    await db.query("delete from public.store_categories where category_slug in ('e2e-moda', 'e2e-pets')");
    await db.query("delete from public.categories where slug in ('e2e-moda', 'e2e-pets')");
  });
  await invalidateCatalog();
});

test("dropdown compacto filtra lojas, mantém ordenação e permite limpar categoria", async ({ page }) => {
  await page.goto("/?sort=az");
  const trigger = page.getByRole("button", { name: "Categorias", exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect((await new AxeBuilder({ page }).include("#catalogo").analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Moda e acessórios", exact: true }).click();
  await expect(page).toHaveURL(/category=e2e-moda/);
  await expect(page).toHaveURL(/sort=az/);
  await expect(page.getByRole("heading", { name: "Moda e acessórios", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver ofertas de Loja Alfa Cashback" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver ofertas de Loja Beta Solo" })).toHaveCount(0);
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page.getByRole("link", { name: "Todas as lojas", exact: true }).click();
  await expect(page).not.toHaveURL(/category=/);
  await expect(page.getByRole("heading", { name: "Todas as lojas", exact: true })).toBeVisible();
});

test("busca preserva categoria; filtro vazio e inválido têm saída explícita", async ({ page }) => {
  await page.goto("/?category=e2e-moda&sort=az");
  await page.getByRole("searchbox", { name: "Buscar loja" }).fill("sem correspondência");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page).toHaveURL(/category=e2e-moda/);
  await expect(page).toHaveURL(/sort=az/);
  await expect(page.getByRole("link", { name: "Limpar busca" })).toBeVisible();
  await page.getByRole("link", { name: "Limpar busca" }).click();
  await expect(page).toHaveURL(/category=e2e-moda/);
  await expect(page.getByRole("heading", { name: "Moda e acessórios" })).toBeVisible();

  await page.goto("/?category=e2e-pets");
  await expect(page.getByText("Nenhuma loja com cashback disponível nesta seleção.")).toBeVisible();
  await page.goto("/?category=desconhecida");
  await expect(page.getByRole("heading", { name: "Categoria indisponível" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Remover categoria" })).toBeVisible();
});
