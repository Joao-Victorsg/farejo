import { describe, expect, it } from "vitest";
import { CategoryManifest } from "./categoryManifest.js";

const valid = {
  version: 1,
  status: "approved",
  categories: [{ slug: "moda", name: "Moda", icon: "shirt", position: 1, active: true }],
  stores: [{ slug: "loja-a", categories: [{ slug: "moda", evidence: [{ url: "https://example.test/moda", observedAt: "2026-09-10", note: "Departamento oficial" }] }] }],
};

describe("manifesto de categorias", () => {
  it("aceita uma classificação revisada com fonte", () => {
    expect(CategoryManifest.parse(valid)).toEqual(valid);
  });

  it.each([
    { stores: [{ slug: "loja-a", categories: [{ slug: "moda", evidence: [] }] }] },
    { stores: [{ slug: "loja-a", categories: [{ slug: "outra", evidence: valid.stores[0]?.categories[0]?.evidence }] }] },
    { stores: [{ slug: "loja-a", categories: [{ slug: "moda", evidence: [{ url: "https://example.test", observedAt: "2026-02-30", note: "Fonte" }] }] }] },
    { stores: [valid.stores[0], valid.stores[0]] },
    { categories: [{ ...valid.categories[0], icon: "unknown" }] },
    { status: "pending" },
  ])("rejeita classificação incompleta ou ainda não aprovada", (change) => {
    expect(() => CategoryManifest.parse({ ...valid, ...change })).toThrow();
  });
});
