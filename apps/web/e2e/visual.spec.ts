import { expect, test } from "@playwright/test";
import { activationErrorHtml } from "../src/components/activation-error";
import { fixtureSlug } from "./db";

const alphaSlug = fixtureSlug("alpha");
const betaSlug = fixtureSlug("beta");
const gammaSlug = fixtureSlug("gamma");
const deltaSlug = fixtureSlug("delta");

test.describe("regressão visual @ 1440px", () => {
  test("catálogo com lojas elegíveis: MELHOR, BOOST, ATÉ, ATRASADO, VALOR FIXO e +N", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: `Ver ofertas de ${"Loja Alfa Cashback"}` })).toBeVisible();
    await expect(page).toHaveScreenshot("home-catalog-seeded.png", { fullPage: true });
  });

  test("busca sem resultado", async ({ page }) => {
    await page.goto("/?q=zzz-termo-que-nao-existe-zzz");
    await expect(page.getByRole("heading", { name: "Nenhuma loja com cashback disponível foi encontrada." })).toBeVisible();
    await expect(page).toHaveScreenshot("home-search-no-results.png", { fullPage: true });
  });

  test("busca com resultado via alias", async ({ page }) => {
    await page.goto(`/?q=${encodeURIComponent("Termo Único De Busca Testável")}`);
    await expect(page.getByRole("link", { name: "Ver ofertas de Loja Alfa Cashback" })).toBeVisible();
    await expect(page).toHaveScreenshot("home-search-with-results.png", { fullPage: true });
  });

  test("loja com ranking completo e histórico construído (boost)", async ({ page }) => {
    await page.goto(`/loja/${alphaSlug}`);
    await expect(page.getByRole("heading", { name: "Loja Alfa Cashback", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Histórico", exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot("store-detail-full-ranking-boost.png", { fullPage: true });
  });

  test("loja com uma única plataforma e toggle Inter correntista", async ({ page }) => {
    await page.goto(`/loja/${betaSlug}`);
    await expect(page.getByRole("heading", { name: "Loja Beta Solo", level: 1 })).toBeVisible();
    await expect(page).toHaveScreenshot("store-detail-single-platform.png", { fullPage: true });
  });

  test("loja indisponível (sem oferta elegível) com histórico sendo construído", async ({ page }) => {
    await page.goto(`/loja/${gammaSlug}`);
    await expect(page.getByRole("heading", { name: "Sem ofertas no momento" })).toBeVisible();
    await expect(page.getByText("Ainda estamos coletando os valores de cashback desta loja.")).toBeVisible();
    await expect(page).toHaveScreenshot("store-detail-unavailable.png", { fullPage: true });
  });

  test("loja disponível com histórico sendo construído", async ({ page }) => {
    await page.goto(`/loja/${deltaSlug}`);
    await expect(page.getByRole("heading", { name: "Loja Delta Sem Histórico", level: 1 })).toBeVisible();
    await expect(page.getByText("Ainda estamos coletando os valores de cashback desta loja.")).toBeVisible();
    await expect(page).toHaveScreenshot("store-detail-history-building.png", { fullPage: true });
  });

  test("página de plataformas", async ({ page }) => {
    await page.goto("/plataformas");
    await expect(page.getByRole("heading", { name: "Plataformas de cashback", level: 1 })).toBeVisible();
    await expect(page).toHaveScreenshot("platforms.png", { fullPage: true });
  });

  test("página como funciona", async ({ page }) => {
    await page.goto("/como-funciona");
    await expect(page.getByRole("heading", { name: "Como o farejô funciona", level: 1 })).toBeVisible();
    await expect(page).toHaveScreenshot("how-it-works.png", { fullPage: true });
  });

  test("página de FAQ", async ({ page }) => {
    await page.goto("/faq");
    await expect(page.getByRole("heading", { name: "Perguntas frequentes", level: 1 })).toBeVisible();
    await expect(page).toHaveScreenshot("faq.png", { fullPage: true });
  });

  test("ativação: oferta encerrada (410, via wiring real)", async ({ page }) => {
    const response = await page.goto(`/go/${gammaSlug}/inter`);
    expect(response?.status()).toBe(410);
    await expect(page.getByRole("heading", { name: "Esta oferta não está mais disponível" })).toBeVisible();
    await expect(page).toHaveScreenshot("activation-unavailable-410.png", { fullPage: true });
  });

  // Sem hook de fault injection no app (deliberado: nenhum controle de debug entra em
  // produção), uma falha transitória real de banco não é reproduzível de forma determinística
  // num pool de conexão já inicializado pelos testes anteriores. `activationErrorHtml` é a
  // mesma função usada pela rota real para os dois desfechos (T6/#52) — renderizamos o HTML
  // gerado por ela diretamente para cobrir a aparência do estado 503 sem depender de rede.
  test("ativação: falha temporária (503, mesmo template da rota real)", async ({ page }) => {
    const html = activationErrorHtml({ kind: "temporary", retryHref: `/go/${gammaSlug}/inter`, storeHref: `/loja/${gammaSlug}` });
    await page.setContent(html, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "Não conseguimos validar esta oferta agora" })).toBeVisible();
    await expect(page).toHaveScreenshot("activation-temporary-503.png", { fullPage: true });
  });
});
