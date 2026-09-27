import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const { after, recordActivation, recordGa4Redirect, resolveActivation } = vi.hoisted(() => ({
  after: vi.fn(),
  recordActivation: vi.fn(),
  recordGa4Redirect: vi.fn(),
  resolveActivation: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after,
}));
vi.mock("../src/lib/activation.js", () => ({ recordActivation, resolveActivation }));
vi.mock("../src/lib/ga4-measurement.js", () => ({ recordGa4Redirect }));

import { GET } from "../src/app/go/[storeSlug]/[platformId]/route.js";

function request(path: string) {
  return new Request(`https://farejo.test${path}`);
}

function smokeRequest(path: string, secret = "test-smoke-secret") {
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret)
    .update(timestamp)
    .update(`GET\n${path}`)
    .digest("hex");
  return new Request(`https://farejo.test${path}`, {
    headers: {
      "x-farejo-smoke-timestamp": timestamp,
      "x-farejo-smoke-signature": signature,
    },
  });
}

function context(storeSlug = "loja-segura", platformId = "inter") {
  return { params: Promise.resolve({ storeSlug, platformId }) };
}

describe("GET /go/[storeSlug]/[platformId]", () => {
  beforeEach(() => {
    vi.stubEnv("FAREJO_CATALOG_INVALIDATION_SECRET", "test-smoke-secret");
    after.mockReset();
    recordActivation.mockReset();
    recordActivation.mockResolvedValue(undefined);
    recordGa4Redirect.mockReset();
    recordGa4Redirect.mockResolvedValue(undefined);
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
    expect(recordActivation).toHaveBeenCalledWith(91, "inter", "user");
    expect(recordGa4Redirect).toHaveBeenCalledWith(expect.any(Request), { storeSlug: "loja-segura", platformId: "inter" });
  });

  it("records signed production smoke redirects separately from user activations", async () => {
    resolveActivation.mockResolvedValue({ kind: "available", storeId: 91, destination: "https://shopping.inter.co/site-parceiro/lojas/loja-segura" });

    const response = await GET(smokeRequest("/go/loja-segura/inter"), context());

    expect(response.status).toBe(307);
    await after.mock.calls[0]?.[0]();
    expect(recordActivation).toHaveBeenCalledWith(91, "inter", "production_smoke");
    expect(recordGa4Redirect).not.toHaveBeenCalled();
  });

  it("keeps the post-response task alive until the metric write settles", async () => {
    let resolveWrite: (() => void) | undefined;
    recordActivation.mockReturnValue(new Promise<void>((resolve) => { resolveWrite = resolve; }));
    resolveActivation.mockResolvedValue({ kind: "available", storeId: 91, destination: "https://shopping.inter.co/site-parceiro/lojas/loja-segura" });

    const response = await GET(request("/go/loja-segura/inter"), context());
    expect(response.status).toBe(307);

    const callback = after.mock.calls[0]?.[0] as (() => unknown) | undefined;
    const task = callback?.();
    expect(task).toBeInstanceOf(Promise);
    let completed = false;
    void (task as Promise<void>).then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);

    resolveWrite?.();
    await task;
    expect(completed).toBe(true);
  });

  it("treats an invalid smoke signature as an ordinary activation", async () => {
    resolveActivation.mockResolvedValue({ kind: "available", storeId: 91, destination: "https://shopping.inter.co/site-parceiro/lojas/loja-segura" });

    const invalid = new Request("https://farejo.test/go/loja-segura/inter", {
      headers: {
        "x-farejo-smoke-timestamp": String(Date.now()),
        "x-farejo-smoke-signature": "0".repeat(64),
      },
    });
    const response = await GET(invalid, context());

    expect(response.status).toBe(307);
    await after.mock.calls[0]?.[0]();
    expect(recordActivation).toHaveBeenCalledWith(91, "inter", "user");
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
    expect(after).not.toHaveBeenCalled();
    expect(recordActivation).not.toHaveBeenCalled();
    expect(recordGa4Redirect).not.toHaveBeenCalled();
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
    expect(recordActivation).not.toHaveBeenCalled();
    expect(recordGa4Redirect).not.toHaveBeenCalled();
  });
});
