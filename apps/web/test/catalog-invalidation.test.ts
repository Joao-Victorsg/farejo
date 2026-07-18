import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));

vi.mock("next/cache", () => ({ revalidateTag }));

import { POST } from "../src/app/api/internal/catalog-invalidation/route.js";

const secret = "test-catalog-invalidation-secret-at-least-32-characters";
const now = Date.now();

function signedRequest(body: string, timestamp = String(now), signature?: string) {
  const digest = signature ?? createHmac("sha256", secret).update(timestamp).update(body).digest("hex");
  return new Request("https://farejo.test/api/internal/catalog-invalidation", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-farejo-timestamp": timestamp,
      "x-farejo-signature": digest,
    },
    body,
  });
}

function payload(timestamp = now) {
  return JSON.stringify({ platform_id: "inter", run_id: 49, timestamp });
}

describe("POST /api/internal/catalog-invalidation", () => {
  beforeEach(() => {
    process.env.FAREJO_CATALOG_INVALIDATION_SECRET = secret;
    delete process.env.VERCEL;
    revalidateTag.mockReset();
  });

  it("accepts a valid signed event and expires the catalog tag", async () => {
    const response = await POST(signedRequest(payload()));

    expect(response.status).toBe(204);
    expect(revalidateTag).toHaveBeenCalledWith("catalog", { expire: 0 });
  });

  it("rejects an invalid signature without invalidating anything", async () => {
    const response = await POST(signedRequest(payload(), String(now), "0".repeat(64)));

    expect(response.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects an HTTP request even when it forges the forwarded protocol", async () => {
    const request = signedRequest(payload());
    const response = await POST(new Request("http://farejo.test/api/internal/catalog-invalidation", {
      method: "POST",
      headers: { ...Object.fromEntries(request.headers), "x-forwarded-proto": "https" },
      body: payload(),
    }));

    expect(response.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects an expired timestamp", async () => {
    const expiredTimestamp = String(now - 10 * 60 * 1_000);
    const response = await POST(signedRequest(payload(Number(expiredTimestamp)), expiredTimestamp));

    expect(response.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects a body changed after it was signed", async () => {
    const original = payload();
    const changed = JSON.stringify({ platform_id: "zoom", run_id: 49, timestamp: now });
    const response = await POST(signedRequest(changed, String(now), createHmac("sha256", secret).update(String(now)).update(original).digest("hex")));

    expect(response.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("accepts a curation invalidation event with run_id 0 (F3/T12, no scrape_runs.id)", async () => {
    const body = JSON.stringify({ platform_id: "curation", run_id: 0, timestamp: now });
    const response = await POST(signedRequest(body));

    expect(response.status).toBe(204);
    expect(revalidateTag).toHaveBeenCalledWith("catalog", { expire: 0 });
  });

  it("accepts a replay inside the short validity window as an idempotent invalidation", async () => {
    const body = payload();
    const requestOne = signedRequest(body);
    const requestTwo = signedRequest(body);

    await expect(POST(requestOne)).resolves.toMatchObject({ status: 204 });
    await expect(POST(requestTwo)).resolves.toMatchObject({ status: 204 });
    expect(revalidateTag).toHaveBeenCalledTimes(2);
  });
});
