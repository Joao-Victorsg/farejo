import { beforeEach, describe, expect, it, vi } from "vitest";

const { after, recordActivation, resolveActivation } = vi.hoisted(() => ({
  after: vi.fn(),
  recordActivation: vi.fn(),
  resolveActivation: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after,
}));
vi.mock("../src/lib/activation.js", () => ({ recordActivation, resolveActivation }));

import { GET } from "../src/app/go/[storeSlug]/[platformId]/route.js";

function request(path: string) {
  return new Request(`https://farejo.test${path}`);
}

function context(storeSlug = "loja-segura", platformId = "inter") {
  return { params: Promise.resolve({ storeSlug, platformId }) };
}

describe("GET /go/[storeSlug]/[platformId]", () => {
  beforeEach(() => {
    after.mockReset();
    recordActivation.mockReset();
    recordActivation.mockResolvedValue(undefined);
    resolveActivation.mockReset();
  });

  it("redirects temporarily and schedules aggregate telemetry without delaying the response", async () => {
    resolveActivation.mockResolvedValue({ kind: "available", storeId: 91, destination: "https://shopping.inter.co/site-parceiro/lojas/loja-segura" });

    const response = await GET(request("/go/loja-segura/inter"), context());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://shopping.inter.co/site-parceiro/lojas/loja-segura");
    expect(after).toHaveBeenCalledOnce();
    expect(recordActivation).not.toHaveBeenCalled();
    await after.mock.calls[0]?.[0]();
    expect(recordActivation).toHaveBeenCalledWith(91, "inter");
  });

  it("returns a noindex 410 without leaking a destination when the offer is unavailable or forged", async () => {
    resolveActivation.mockResolvedValue({ kind: "unavailable" });

    const response = await GET(request("/go/loja-forjada/portal-forjado"), context("loja-forjada", "portal-forjado"));
    const html = await response.text();

    expect(response.status).toBe(410);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(html).toContain("Esta oferta não está mais disponível");
    expect(html).toContain("/loja/loja-forjada");
    expect(html).not.toContain("https://shopping.inter.co");
  });

  it("returns a retryable noindex 503 when validation fails", async () => {
    resolveActivation.mockRejectedValue(new Error("database timeout"));

    const response = await GET(request("/go/loja-segura/inter"), context());
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(html).toContain("Não conseguimos validar esta oferta agora");
    expect(html).toContain("Tentar novamente");
    expect(after).not.toHaveBeenCalled();
  });
});
