import { describe, expect, it } from "vitest";
import { levenshteinDistance, levenshteinRatio } from "./similarity.js";

describe("levenshteinDistance", () => {
  it("is zero for identical strings", () => {
    expect(levenshteinDistance("nike", "nike")).toBe(0);
  });

  it("counts a single substitution", () => {
    expect(levenshteinDistance("nike", "nika")).toBe(1);
  });

  it("counts insertions for a plural", () => {
    expect(levenshteinDistance("tenis", "tenis1")).toBe(1);
  });

  it("is symmetric", () => {
    expect(levenshteinDistance("umbro", "umbros")).toBe(levenshteinDistance("umbros", "umbro"));
  });
});

describe("levenshteinRatio", () => {
  it("is 1 for identical strings", () => {
    expect(levenshteinRatio("nike", "nike")).toBe(1);
  });

  it("is 1 for two empty strings", () => {
    expect(levenshteinRatio("", "")).toBe(1);
  });

  it("is high for a near-typo pair", () => {
    expect(levenshteinRatio("tanara", "tanaraa")).toBeGreaterThanOrEqual(0.85);
  });

  it("is low for unrelated words", () => {
    expect(levenshteinRatio("nike", "casasbahia")).toBeLessThan(0.5);
  });
});
