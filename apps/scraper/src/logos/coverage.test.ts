import { describe, expect, it } from "vitest";
import { computeLogoCoverage, formatLogoCoverageReport, LOGO_COVERAGE_TARGET, type CoveragePool } from "./coverage.js";

function fakePool(row: { eligible_stores: number; stores_with_logo: number } | null): CoveragePool {
  return {
    async query<T = unknown>() {
      return { rows: (row ? [row] : []) as T[] };
    },
  };
}

describe("computeLogoCoverage", () => {
  it("computes the ratio and flags the target as met at exactly 95%", async () => {
    const report = await computeLogoCoverage(fakePool({ eligible_stores: 100, stores_with_logo: 95 }));
    expect(report).toEqual({ eligibleStores: 100, storesWithLogo: 95, coverage: 0.95, meetsTarget: true });
  });

  it("flags the target as unmet just below 95%", async () => {
    const report = await computeLogoCoverage(fakePool({ eligible_stores: 100, stores_with_logo: 94 }));
    expect(report.meetsTarget).toBe(false);
  });

  it("treats zero eligible stores as trivially meeting the target (nothing to fall short of)", async () => {
    const report = await computeLogoCoverage(fakePool({ eligible_stores: 0, stores_with_logo: 0 }));
    expect(report.coverage).toBe(1);
    expect(report.meetsTarget).toBe(true);
  });

  it("treats a missing row the same as zero/zero", async () => {
    const report = await computeLogoCoverage(fakePool(null));
    expect(report).toEqual({ eligibleStores: 0, storesWithLogo: 0, coverage: 1, meetsTarget: true });
  });

  it("exposes the target used by the boundary checks above", () => {
    expect(LOGO_COVERAGE_TARGET).toBe(0.95);
  });
});

describe("formatLogoCoverageReport", () => {
  it("marks a report that meets the target with a check mark", () => {
    const text = formatLogoCoverageReport({ eligibleStores: 100, storesWithLogo: 96, coverage: 0.96, meetsTarget: true });
    expect(text).toContain("✅");
    expect(text).toContain("96/100");
    expect(text).toContain("96.0%");
  });

  it("marks a report below the target with a warning", () => {
    const text = formatLogoCoverageReport({ eligibleStores: 100, storesWithLogo: 80, coverage: 0.8, meetsTarget: false });
    expect(text).toContain("⚠️");
    expect(text).toContain("80/100");
  });
});
