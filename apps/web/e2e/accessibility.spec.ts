import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { fixtureSlug } from "./db";

const alphaSlug = fixtureSlug("alpha");
const betaSlug = fixtureSlug("beta");
const gammaSlug = fixtureSlug("gamma");
const deltaSlug = fixtureSlug("delta");

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const ROUTES: { path: string; label: string }[] = [
  { path: "/", label: "catálogo com lojas" },
  { path: "/?q=zzz-termo-que-nao-existe-zzz", label: "busca sem resultado" },
  { path: `/loja/${alphaSlug}`, label: "loja com ranking completo" },
  { path: `/loja/${betaSlug}`, label: "loja com uma plataforma" },
  { path: `/loja/${gammaSlug}`, label: "loja indisponível" },
  { path: `/loja/${deltaSlug}`, label: "loja com histórico sendo construído" },
  { path: "/plataformas", label: "plataformas" },
  { path: "/como-funciona", label: "como funciona" },
  { path: "/faq", label: "faq" },
];

for (const route of ROUTES) {
  test(`auditoria automatizada (axe) sem bloqueadores: ${route.label}`, async ({ page }) => {
    await page.goto(route.path);
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}

test("navegação por teclado: skip link, nav e busca sem armadilha de foco", async ({ page }) => {
  await page.goto("/");
  // Aguarda o conteúdo real (pós-streaming do skeleton em loading.tsx) antes de exercitar o skip
  // link — ver responsive.spec.ts para o mesmo cuidado.
  await expect(page.locator("#hero-search")).toBeVisible();

  await page.getByRole("link", { name: "Pular para o conteúdo" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#conteudo")).toBeFocused();

  await page.locator("#hero-search").focus();
  await expect(page.locator("#hero-search")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Buscar" })).toBeFocused();
});

test("navegação por teclado: ranking da loja ativa sem abrir nova aba sem aviso", async ({ page }) => {
  await page.goto(`/loja/${alphaSlug}`);
  const firstActivateLink = page.getByRole("link", { name: /Ativar cashback pela .* \(abre em nova aba\)/ }).first();
  await expect(firstActivateLink).toBeVisible();
  await firstActivateLink.focus();
  await expect(firstActivateLink).toBeFocused();
});
