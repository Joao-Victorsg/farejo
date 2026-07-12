import { RetryableError } from "@farejo/shared";
import { loadFixture } from "@farejo/test-fixtures";
import { describe, expect, it } from "vitest";
import { parseZoom } from "./zoom.js";

describe("parseZoom", () => {
  const fixture = loadFixture("zoom-lojas.html");
  const result = parseZoom(fixture);

  it("counts every seller in the RSC flight, before filtering inactives", () => {
    expect(result.rawCount).toBe(212);
  });

  it("reads the declared total from the 'N lojas encontradas' header", () => {
    expect(result.declaredTotal).toBe(212);
  });

  it("filters to active sellers only (bestFormula > 0)", () => {
    expect(result.offers).toHaveLength(171);
  });

  it("reports a full scope", () => {
    expect(result.scope).toEqual({ kind: "full" });
  });

  it("reports zero soft blocks (clean JSON flight, no soft-block signal)", () => {
    expect(result.softBlocks).toBe(0);
  });

  it("keeps Continental active even though allMerchant is null (bestFormula is the only gate)", () => {
    const offer = result.offers.find((o) => o.storeName === "Continental");
    expect(offer).toBeDefined();
    expect(offer?.rewardText).toBe("1% de volta");
  });

  it("marks Fast Shop as 'até' — the only store with more than one positive rate", () => {
    const offer = result.offers.find((o) => o.storeName === "Fast Shop");
    expect(offer?.rewardText).toBe("até 6% de volta");
  });

  it("does not mark a single-rate store as 'até'", () => {
    const offer = result.offers.find((o) => o.storeName === "Continental");
    expect(offer?.rewardText.startsWith("até")).toBe(false);
  });

  it("builds an absolute url from paths.homePage", () => {
    const offer = result.offers[0];
    expect(offer?.url).toMatch(/^https:\/\/www\.zoom\.com\.br\//);
  });

  it("throws a RetryableError when the flight has no 'sellers' key (layout change or block)", () => {
    expect(() => parseZoom("<html><body>bloqueado</body></html>")).toThrow(RetryableError);
  });

  it("skips a malformed individual seller instead of crashing the whole parse", () => {
    const sellers = JSON.parse(loadFixture("zoom-sellers.json")) as unknown[];
    const withMalformedSeller = [...sellers, { broken: true }];
    const html = `<script>self.__next_f.push([1,${JSON.stringify(`"sellers":${JSON.stringify(withMalformedSeller)}`)}])</script>`;

    const malformed = parseZoom(html);
    expect(malformed.rawCount).toBe(213);
    expect(malformed.offers).toHaveLength(171);
  });
});
