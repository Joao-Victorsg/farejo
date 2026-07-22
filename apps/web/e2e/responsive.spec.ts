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
      await expect(page.locator("#hero-search")).toBeVisible();
      await expect(page.getByRole("link", { name: "Ver ofertas de Loja Alfa Cashback" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test("detalhe da loja: ranking e CTA continuam utilizáveis", async ({ page }) => {
      await page.goto(`/loja/${alphaSlug}`);
      await expect(page.getByRole("heading", { name: "Loja Alfa Cashback", level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: /Ativar cashback pela/ }).first()).toBeVisible();
      const historyChart = page.getByRole("application", { name: /Gráfico do histórico/ }).first();
      await expect(historyChart).toBeVisible();
      // A densidade de ticks acompanha o vão da janela, que agora depende do histórico da loja.
      // Afirmamos a faixa (desktop é o caso denso) em vez de um número que só vale para o span
      // exato do fixture — o que importa é a relação com o reflow estreito abaixo.
      expect(await historyChart.locator(".recharts-xAxis .recharts-cartesian-axis-tick").count()).toBeGreaterThanOrEqual(8);
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
      // Aguarda o conteúdo real (pós-streaming do skeleton em loading.tsx) antes de exercitar o
      // skip link: focar/ativar antes disso testaria um estado transitório de Suspense, não a
      // navegação por teclado que o usuário de fato encontra.
      await expect(page.getByRole("link", { name: "Ver ofertas de Loja Alfa Cashback" })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const skipLink = page.getByRole("link", { name: "Pular para o conteúdo" });
      await skipLink.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#conteudo")).toBeFocused();

      await expect(page.locator("#hero-search")).toBeVisible();
    });

    test("detalhe da loja: sem rolagem horizontal e CTA acessível", async ({ page }) => {
      await page.goto(`/loja/${alphaSlug}`);
      const historyChart = page.getByRole("application", { name: /Gráfico do histórico/ }).first();
      await expect(historyChart).toBeVisible();
      const visibleDateTicks = await historyChart.locator(".recharts-xAxis .recharts-cartesian-axis-tick").count();
      // Reflow estreito rareia as datas em vez de amontoá-las; o desktop acima fica sempre mais denso.
      expect(visibleDateTicks).toBeGreaterThanOrEqual(2);
      expect(visibleDateTicks).toBeLessThanOrEqual(viewport.width >= 640 ? 6 : 4);
      await expectNoHorizontalOverflow(page);
      await expect(page.getByRole("link", { name: /Ativar cashback pela/ }).first()).toBeVisible();
      if (viewport.width === 375) await expect(page).toHaveScreenshot("store-detail-history-mobile.png", { fullPage: true });
    });

    test("plataformas, como funciona e FAQ: sem rolagem horizontal", async ({ page }) => {
      for (const path of ["/plataformas", "/como-funciona", "/faq"]) {
        await page.goto(path);
        await expectNoHorizontalOverflow(page);
      }
    });
  });
}
