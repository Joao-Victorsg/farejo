import { describe, expect, it } from "vitest";
import { isSquareish, pickBestLogoSource } from "./logo.js";

describe("isSquareish", () => {
  it("is true for an exact square", () => {
    expect(isSquareish(128, 128)).toBe(true);
  });

  it("tolerates small export slack", () => {
    expect(isSquareish(128, 120)).toBe(true);
  });

  it("is false for the mycashback banner shape", () => {
    expect(isSquareish(250, 80)).toBe(false);
  });

  it("is false for zero or negative dimensions", () => {
    expect(isSquareish(0, 128)).toBe(false);
    expect(isSquareish(128, 0)).toBe(false);
  });
});

describe("pickBestLogoSource", () => {
  it("returns null for an empty list", () => {
    expect(pickBestLogoSource([])).toBeNull();
  });

  it("returns the only candidate", () => {
    const only = { platformId: "zoom", width: 200, height: 200 };
    expect(pickBestLogoSource([only])).toBe(only);
  });

  it("prefers a square source over a wider banner even if the banner has more area", () => {
    const banner = { platformId: "mycashback", width: 250, height: 80 };
    const square = { platformId: "zoom", width: 128, height: 128 };
    expect(pickBestLogoSource([banner, square])).toBe(square);
  });

  it("prefers higher resolution among square sources", () => {
    const small = { platformId: "cuponomia", width: 96, height: 96 };
    const large = { platformId: "zoom", width: 200, height: 200 };
    expect(pickBestLogoSource([small, large])).toBe(large);
  });

  it("falls back to the banner when it is the only valid source", () => {
    const banner = { platformId: "mycashback", width: 250, height: 80 };
    expect(pickBestLogoSource([banner])).toBe(banner);
  });

  it("breaks ties deterministically by platformId", () => {
    const b = { platformId: "b-platform", width: 128, height: 128 };
    const a = { platformId: "a-platform", width: 128, height: 128 };
    expect(pickBestLogoSource([b, a])).toBe(a);
  });
});
