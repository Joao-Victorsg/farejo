import { describe, expect, it } from "vitest";
import { createGoogleTag } from "../src/lib/analytics-gtag";

describe("Google tag command queue", () => {
  it("queues commands in the arguments format consumed by gtag.js", () => {
    const dataLayer: unknown[] = [];
    const gtag = createGoogleTag(dataLayer);

    gtag("consent", "default", { analytics_storage: "denied" });

    expect(dataLayer).toHaveLength(1);
    expect(dataLayer[0]).not.toBeInstanceOf(Array);
    expect(dataLayer[0]).toMatchObject({
      0: "consent",
      1: "default",
      2: { analytics_storage: "denied" },
      length: 3,
    });
  });
});
