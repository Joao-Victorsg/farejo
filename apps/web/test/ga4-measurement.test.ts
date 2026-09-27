import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { recordGa4Redirect } from "../src/lib/ga4-measurement.js";

const analyticsCookies = "farejo_ga4_consent=v1.granted; _ga=GA1.1.123456.1700000000; _ga_TEST123=GS1.1.1700000000.1.1.1700000300.0.0.0";

function request(cookie: string) {
  return new Request("https://farejo.test/go/amazon/inter?q=termo-privado", {
    headers: { cookie },
  });
}

describe("GA4 redirect Measurement Protocol", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends a 307 event only for an explicitly consented session and omits query values", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA4_MEASUREMENT_ID", "G-TEST123");
    vi.stubEnv("GA4_API_SECRET", "example-secret");
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await recordGa4Redirect(request(analyticsCookies), { storeSlug: "amazon", platformId: "inter" });

    expect(fetch).toHaveBeenCalledOnce();
    const [input, init] = fetch.mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(url.searchParams.get("measurement_id")).toBe("G-TEST123");
    expect(url.searchParams.get("api_secret")).toBe("example-secret");
    expect(init).toMatchObject({ method: "POST", cache: "no-store" });
    const payload = z.object({
      client_id: z.string(),
      events: z.array(z.object({ name: z.string(), params: z.record(z.string(), z.unknown()) })),
    }).parse(JSON.parse(String(init?.body)));
    expect(payload.client_id).toBe("GA1.1.123456.1700000000");
    expect(payload.events).toEqual([{
      name: "activation_redirect",
      params: {
        session_id: "GS1.1.1700000000.1.1.1700000300.0.0.0",
        page_location: "https://farejo.test/go/amazon/inter",
        store_slug: "amazon",
        platform_id: "inter",
      },
    }]);
    expect(String(init?.body)).not.toContain("termo-privado");
  });

  it("does not send an event without explicit consent or GA session cookies", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA4_MEASUREMENT_ID", "G-TEST123");
    vi.stubEnv("GA4_API_SECRET", "example-secret");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await recordGa4Redirect(request("_ga=GA1.1.123456.1700000000"), { storeSlug: "amazon", platformId: "inter" });
    await recordGa4Redirect(request("farejo_ga4_consent=v1.granted; _ga=GA1.1.123456.1700000000"), { storeSlug: "amazon", platformId: "inter" });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips measurement when GA4 is not configured", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await recordGa4Redirect(request(analyticsCookies), { storeSlug: "amazon", platformId: "inter" });

    expect(fetch).not.toHaveBeenCalled();
  });
});
