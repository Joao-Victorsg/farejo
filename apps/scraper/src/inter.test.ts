import { loadFixture } from "@farejo/test-fixtures";
import { describe, expect, it } from "vitest";
import { parseInter } from "./inter.js";

describe("parseInter", () => {
  const fixture = loadFixture("inter-stores.api.json");
  const result = parseInter(fixture);

  it("counts every store received, before filtering inactives", () => {
    expect(result.rawCount).toBe(374);
  });

  it("reads the declared total from pagination.total", () => {
    expect(result.declaredTotal).toBe(374);
  });

  it("filters out the 11 stores with fullCashbackValue:0", () => {
    expect(result.offers).toHaveLength(363);
  });

  it("reports a full scope", () => {
    expect(result.scope).toEqual({ kind: "full" });
  });

  it("reports zero soft blocks (clean JSON API, no soft-block signal)", () => {
    expect(result.softBlocks).toBe(0);
  });

  it("maps partialCashback to the generic partialRewardText channel", () => {
    const offer = result.offers.find((o) => o.storeName === "Drogaria Venancio");
    expect(offer).toMatchObject({
      storeName: "Drogaria Venancio",
      rewardText: "4.9% cashback",
      partialRewardText: "3.43% cashback",
      url: "https://shopping.inter.co/site-parceiro/lojas/drogaria-venancio",
    });
  });

  it("does not emit an offer for a fullCashbackValue:0 store (Amazon)", () => {
    expect(result.offers.find((o) => o.storeName === "Amazon")).toBeUndefined();
  });

  it("leaves previousRewardText undefined when the API omits previousCashback", () => {
    const offer = result.offers.find((o) => o.storeName === "Drogaria Venancio");
    expect(offer?.previousRewardText).toBeUndefined();
  });

  it("skips a malformed individual store instead of crashing the whole parse", () => {
    const fixtureData = JSON.parse(fixture) as { stores: unknown[]; pagination: { total: number } };
    const stores = [...fixtureData.stores, { slug: "broken", name: "Broken" }];
    const withMalformedStore = parseInter(
      JSON.stringify({ stores, pagination: fixtureData.pagination }),
    );

    expect(withMalformedStore.rawCount).toBe(375);
    expect(withMalformedStore.offers).toHaveLength(363);
  });
});
