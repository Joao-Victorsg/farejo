import { describe, expect, it } from "vitest";
import { searchResultBucket, searchResultsEventParams } from "../src/lib/search-analytics.js";

describe("search results analytics", () => {
  it("groups results into quantity bands", () => {
    expect([0, 1, 2, 5, 6, 100].map(searchResultBucket)).toEqual(["0", "1", "2-5", "2-5", "6+", "6+"]);
  });

  it("never sends the searched term or other URL parameters", () => {
    const event = searchResultsEventParams(new URL("https://www.farejo.site/?q=termo-privado&utm_source=partner"), 3);
    expect(event).toEqual({ result_count_bucket: "2-5", page_location: "https://www.farejo.site/" });
    expect(JSON.stringify(event)).not.toContain("termo-privado");
  });
});
