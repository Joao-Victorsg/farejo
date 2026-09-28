import { beforeEach, describe, expect, it, vi } from "vitest";

const { reportOfferDiscrepancy } = vi.hoisted(() => ({
  reportOfferDiscrepancy: vi.fn<(storeSlug: string, platformId: string) => Promise<boolean>>(),
}));
vi.mock("../src/lib/offer-feedback.js", () => ({ reportOfferDiscrepancy }));

import { POST } from "../src/app/api/offer-discrepancy/route.js";

function submission(body: string, origin = "https://www.farejo.site") {
  return new Request("https://www.farejo.site/api/offer-discrepancy", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body,
  });
}

describe("POST /api/offer-discrepancy", () => {
  beforeEach(() => reportOfferDiscrepancy.mockReset());

  it("accepts a current offer without forwarding visitor identity or free text", async () => {
    reportOfferDiscrepancy.mockResolvedValue(true);
    const response = await POST(submission(JSON.stringify({ storeSlug: "asics", platformId: "zoom" })));
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(reportOfferDiscrepancy).toHaveBeenCalledWith("asics", "zoom");
  });

  it("rejects cross-origin and extra visitor data before touching the database", async () => {
    expect((await POST(submission('{"storeSlug":"asics","platformId":"zoom"}', "https://evil.example"))).status).toBe(403);
    expect((await POST(submission('{"storeSlug":"asics","platformId":"zoom","email":"x@example.com"}'))).status).toBe(400);
    expect(reportOfferDiscrepancy).not.toHaveBeenCalled();
  });

  it("distinguishes expired offers and temporary database failure without leaking details", async () => {
    reportOfferDiscrepancy.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("private database detail"));
    expect((await POST(submission('{"storeSlug":"asics","platformId":"zoom"}'))).status).toBe(404);
    const temporary = await POST(submission('{"storeSlug":"asics","platformId":"zoom"}'));
    expect(temporary.status).toBe(503);
    expect(await temporary.text()).not.toContain("private database detail");
  });
});
