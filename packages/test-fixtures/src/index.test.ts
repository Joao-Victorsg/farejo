import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixturePath, loadFixture } from "./index.js";

describe("fixturePath/loadFixture", () => {
  it("resolves a fixture that exists on disk", () => {
    expect(existsSync(fixturePath("inter-stores.api.json"))).toBe(true);
  });

  it("loads fixture content as utf8 text", () => {
    const raw = loadFixture("inter-stores.api.json");
    const parsed = JSON.parse(raw);
    expect(parsed.pagination.total).toBe(374);
  });
});
