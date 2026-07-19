import { expect, test } from "@playwright/test";
import { fixtureSlug } from "./db";

const alphaSlug = fixtureSlug("alpha");

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "a página não deve exigir rolagem horizontal nesta largura").toBeLessThanOrEqual(1);
}

for (const viewport of [{ width: 1024, height: 900 }, { width: 1280, height: 900 }]) {
  test.describe(`desktop funcional a ${viewport.width}px`, () => {
    test.use({ viewport });

    test("catálogo: navegação, busca e grade continuam utilizáveis", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();
      await expect(page.locator("#catalog-search")).toBeVisible();
      await expect(page.getByRole("link", { name: "Ver ofertas de Loja Alfa Cashback" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test("detalhe da loja: ranking e CTA continuam utilizáveis", async ({ page }) => {
      await page.goto(`/loja/${alphaSlug}`);
      await expect(page.getByRole("heading", { name: "Loja Alfa Cashback", level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: /Ativar cashback pela/ }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });
}

// Sem exigir alta fidelidade mobile (ADR-0044/ADR-0052): só reflow funcional e acessível.
// 640px aproxima o efeito de 200% de zoom sobre um viewport desktop de 1280px.
for (const viewport of [{ width: 640, height: 900 }, { width: 375, height: 800 }]) {
  test.describe(`reflow estreito a ${viewport.width}px`, () => {
    test.use({ viewport });

    test("catálogo: sem rolagem horizontal, skip link e busca continuam operáveis", async ({ page }) => {
      await page.goto("/");
      await expectNoHorizontalOverflow(page);

      const skipLink = page.getByRole("link", { name: "Pular para o conteúdo" });
      await skipLink.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#conteudo")).toBeFocused();

      await expect(page.locator("#catalog-search")).toBeVisible();
      await expect(page.getByRole("link", { name: "Ver ofertas de Loja Alfa Cashback" })).toBeVisible();
    });

    test("detalhe da loja: sem rolagem horizontal e CTA acessível", async ({ page }) => {
      await page.goto(`/loja/${alphaSlug}`);
      await expectNoHorizontalOverflow(page);
      await expect(page.getByRole("link", { name: /Ativar cashback pela/ }).first()).toBeVisible();
    });

    test("plataformas, como funciona e FAQ: sem rolagem horizontal", async ({ page }) => {
      for (const path of ["/plataformas", "/como-funciona", "/faq"]) {
        await page.goto(path);
        await expectNoHorizontalOverflow(page);
      }
    });
  });
}
