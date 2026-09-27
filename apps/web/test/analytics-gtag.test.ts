import { describe, expect, it } from "vitest";
import { createGoogleTag, sendGooglePageView } from "../src/lib/analytics-gtag";

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

  it("sends the first page view after consent and deduplicates the initial route", () => {
    const dataLayer: unknown[] = [];
    const gtag = createGoogleTag(dataLayer);
    const state: { lastPageViewLocation?: string } = {};
    const pageView = {
      pageLocation: "https://farejo.vercel.app/loja/asics",
      pageTitle: "farejô | Página de loja",
      pageReferrer: "https://farejo.vercel.app/",
      storeSlug: "asics",
    };

    sendGooglePageView(gtag, state, pageView);
    sendGooglePageView(gtag, state, pageView);

    expect(dataLayer).toHaveLength(1);
    expect(dataLayer[0]).not.toBeInstanceOf(Array);
    expect(dataLayer[0]).toMatchObject({
      0: "event",
      1: "page_view",
      2: {
        page_location: pageView.pageLocation,
        page_title: pageView.pageTitle,
        page_referrer: pageView.pageReferrer,
        store_slug: pageView.storeSlug,
      },
    });
  });
});
