import { describe, expect, it } from "vitest";
import { withExecutionSource } from "./scrapeRunsTable.js";

describe("withExecutionSource", () => {
  it("preserves notes when the runner is not configured", () => {
    const notes = JSON.stringify({ verdict: "ok", tripped: null });

    expect(withExecutionSource(notes, undefined)).toBe(notes);
  });

  it("marks Cloud Run executions without dropping diagnostic fields", () => {
    const notes = JSON.stringify({ verdict: "suspicious", tripped: "rule1_offers_found" });

    expect(JSON.parse(withExecutionSource(notes, "cloud-run"))).toEqual({
      verdict: "suspicious",
      tripped: "rule1_offers_found",
      execution_source: "cloud-run",
    });
  });

  it("rejects unsupported runner values", () => {
    expect(() => withExecutionSource("{}", "unknown-runner")).toThrow();
  });
});
