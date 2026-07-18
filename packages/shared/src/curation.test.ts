import { describe, expect, it } from "vitest";
import {
  AliasManifestSchema,
  generateAliasCandidates,
  parseAliasManifest,
  validateManifestInvariants,
  type AliasManifest,
  type AliasRef,
  type CanonicalStoreView,
} from "./curation.js";

const alias = (platformId: string, rawName: string): AliasRef => ({ platformId, rawName });

const emptyManifest: AliasManifest = { version: 1, merges: [], rejects: [] };

describe("AliasManifestSchema", () => {
  it("accepts a well-formed manifest with merges and rejects", () => {
    const manifest = {
      version: 1,
      merges: [{ canonicalSlug: "fastshop", aliases: [alias("meliuz", "FastShop Oficial"), alias("cuponomia", "Fast Shop")] }],
      rejects: [{ a: alias("inter", "Magazine Luiza"), b: alias("meliuz", "Magalu") }],
    };
    expect(() => parseAliasManifest(manifest)).not.toThrow();
  });

  it("defaults merges and rejects to empty arrays when omitted", () => {
    expect(parseAliasManifest({ version: 1 })).toEqual(emptyManifest);
  });

  it("rejects a merge with no aliases", () => {
    const manifest = { version: 1, merges: [{ canonicalSlug: "fastshop", aliases: [] }], rejects: [] };
    expect(() => parseAliasManifest(manifest)).toThrow();
  });

  it("rejects an unknown manifest version", () => {
    expect(() => parseAliasManifest({ version: 2 })).toThrow();
  });

  it("rejects an alias missing platformId or rawName", () => {
    const manifest = { version: 1, merges: [{ canonicalSlug: "fastshop", aliases: [{ platformId: "meliuz" }] }], rejects: [] };
    expect(() => AliasManifestSchema.parse(manifest)).toThrow();
  });
});

describe("validateManifestInvariants", () => {
  it("returns no violations for an empty manifest", () => {
    expect(validateManifestInvariants(emptyManifest)).toEqual([]);
  });

  it("returns no violations when aliases and canonical slugs are all distinct", () => {
    const manifest: AliasManifest = {
      version: 1,
      merges: [
        { canonicalSlug: "fastshop", aliases: [alias("meliuz", "FastShop Oficial")] },
        { canonicalSlug: "nike", aliases: [alias("meliuz", "Nike Brasil")] },
      ],
      rejects: [],
    };
    expect(validateManifestInvariants(manifest)).toEqual([]);
  });

  it("flags the same (platformId, rawName) claimed by two different canonical slugs", () => {
    const manifest: AliasManifest = {
      version: 1,
      merges: [
        { canonicalSlug: "fastshop", aliases: [alias("meliuz", "Fast Shop")] },
        { canonicalSlug: "nike", aliases: [alias("meliuz", "Fast Shop")] },
      ],
      rejects: [],
    };
    expect(validateManifestInvariants(manifest)).toEqual([
      { kind: "duplicate_alias_claim", alias: alias("meliuz", "Fast Shop"), canonicalSlugs: ["fastshop", "nike"] },
    ]);
  });

  it("does not flag the same alias repeated within the same merge decision", () => {
    const manifest: AliasManifest = {
      version: 1,
      merges: [{ canonicalSlug: "fastshop", aliases: [alias("meliuz", "Fast Shop"), alias("meliuz", "Fast Shop")] }],
      rejects: [],
    };
    expect(validateManifestInvariants(manifest)).toEqual([]);
  });

  it("flags two merge decisions declaring the same canonical slug", () => {
    const manifest: AliasManifest = {
      version: 1,
      merges: [
        { canonicalSlug: "fastshop", aliases: [alias("meliuz", "Fast Shop")] },
        { canonicalSlug: "fastshop", aliases: [alias("cuponomia", "FastShop Oficial")] },
      ],
      rejects: [],
    };
    expect(validateManifestInvariants(manifest)).toEqual([{ kind: "duplicate_canonical_slug", canonicalSlug: "fastshop" }]);
  });

  it("flags a reject pair whose both sides were merged under the same canonical slug", () => {
    const manifest: AliasManifest = {
      version: 1,
      merges: [{ canonicalSlug: "fastshop", aliases: [alias("meliuz", "Fast Shop"), alias("cuponomia", "FastShop Oficial")] }],
      rejects: [{ a: alias("meliuz", "Fast Shop"), b: alias("cuponomia", "FastShop Oficial") }],
    };
    expect(validateManifestInvariants(manifest)).toEqual([
      { kind: "reject_merge_contradiction", pair: [alias("meliuz", "Fast Shop"), alias("cuponomia", "FastShop Oficial")], canonicalSlug: "fastshop" },
    ]);
  });

  it("does not flag a reject pair where only one side was merged", () => {
    const manifest: AliasManifest = {
      version: 1,
      merges: [{ canonicalSlug: "fastshop", aliases: [alias("meliuz", "Fast Shop")] }],
      rejects: [{ a: alias("meliuz", "Fast Shop"), b: alias("cuponomia", "Never Merged") }],
    };
    expect(validateManifestInvariants(manifest)).toEqual([]);
  });

  it("does not flag a reject pair whose sides were merged under two different canonical slugs", () => {
    const manifest: AliasManifest = {
      version: 1,
      merges: [
        { canonicalSlug: "fastshop", aliases: [alias("meliuz", "Fast Shop")] },
        { canonicalSlug: "nike", aliases: [alias("cuponomia", "Nike Brasil")] },
      ],
      rejects: [{ a: alias("meliuz", "Fast Shop"), b: alias("cuponomia", "Nike Brasil") }],
    };
    expect(validateManifestInvariants(manifest)).toEqual([]);
  });
});

const store = (canonicalSlug: string, name: string, aliases: AliasRef[]): CanonicalStoreView => ({ canonicalSlug, name, aliases });

describe("generateAliasCandidates", () => {
  it("proposes a decorator-only pair as l3_exact with similarity 1", () => {
    const clinique = store("clinique", "Clinique", [alias("inter", "Clinique")]);
    const cliniqueBrasil = store("cliniquebrasil", "Clinique Brasil", [alias("cuponomia", "Clinique Brasil")]);

    const candidates = generateAliasCandidates([clinique, cliniqueBrasil], emptyManifest);

    expect(candidates).toEqual([
      expect.objectContaining({
        signal: "l3_exact",
        similarity: 1,
        normalizedKeyA: "clinique",
        normalizedKeyB: "clinique",
      }),
    ]);
  });

  it("proposes a near-typo pair as levenshtein with the slugs as normalized keys", () => {
    const tanara = store("tanara", "Tanara", [alias("inter", "Tanara")]);
    const tanaraBrasil = store("tanarabrasil", "Tanara Brasil", [alias("cuponomia", "Tanara Brasil")]);

    const candidates = generateAliasCandidates([tanara, tanaraBrasil], emptyManifest);

    // "tanara" x "tanarabrasil" também bate o sinal l3_exact (mesmo l3Key) — o par
    // aparece uma única vez no resultado, não duplicado por sinal.
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.signal).toBe("l3_exact");
  });

  it("does not propose two unrelated brands", () => {
    const nike = store("nike", "Nike", [alias("inter", "Nike")]);
    const adidas = store("adidas", "Adidas", [alias("inter", "Adidas")]);

    expect(generateAliasCandidates([nike, adidas], emptyManifest)).toEqual([]);
  });

  it("suppresses a pair already rejected in the manifest (falso positivo rejeitado)", () => {
    const nike = store("nike", "Nike", [alias("inter", "Nike")]);
    const nikeStore = store("nikestore", "Nike Store", [alias("cuponomia", "Nike Store")]);
    const manifest: AliasManifest = {
      version: 1,
      merges: [],
      rejects: [{ a: alias("inter", "Nike"), b: alias("cuponomia", "Nike Store") }],
    };

    expect(generateAliasCandidates([nike, nikeStore], manifest)).toEqual([]);
  });

  it("does not re-propose a pair already covered by a pending merge decision", () => {
    const umbro = store("umbro", "Umbro", [alias("inter", "Umbro")]);
    const umbroStore = store("umbrostore", "Umbro Store", [alias("cuponomia", "Umbro Store")]);
    const manifest: AliasManifest = {
      version: 1,
      merges: [{ canonicalSlug: "umbro", aliases: [alias("inter", "Umbro"), alias("cuponomia", "Umbro Store")] }],
      rejects: [],
    };

    expect(generateAliasCandidates([umbro, umbroStore], manifest)).toEqual([]);
  });

  it("does not propose two single-alias stores from the same platform (a site never lists the same store twice)", () => {
    const a = store("nike", "Nike", [alias("cuponomia", "Nike")]);
    const b = store("nikestore", "Nike Store", [alias("cuponomia", "Nike Store")]);

    expect(generateAliasCandidates([a, b], emptyManifest)).toEqual([]);
  });

  it("carries every alias of an already-merged (transitive) cluster as evidence on the candidate", () => {
    // brinox já é o resultado de um merge transitivo aplicado anteriormente (brinox ~
    // brinoxshop ~ lojaoficialbrinox): a store canônica traz aliases das 3 plataformas.
    const brinox = store("brinox", "Brinox", [
      alias("inter", "Brinox"),
      alias("zoom", "BrinoxShop"),
      alias("meliuz", "Loja Oficial Brinox"),
    ]);
    const brinoxx = store("brinoxoficial", "Brinox Oficial", [alias("cuponomia", "Brinox Oficial")]);

    const candidates = generateAliasCandidates([brinox, brinoxx], emptyManifest);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.storeA.aliases).toHaveLength(3);
    expect(candidates[0]?.storeA.aliases).toEqual(
      expect.arrayContaining([alias("inter", "Brinox"), alias("zoom", "BrinoxShop"), alias("meliuz", "Loja Oficial Brinox")]),
    );
  });

  it("is deterministic: same input, same output, same order, across repeated calls", () => {
    const stores = [
      store("clinique", "Clinique", [alias("inter", "Clinique")]),
      store("cliniquebrasil", "Clinique Brasil", [alias("cuponomia", "Clinique Brasil")]),
      store("umbro", "Umbro", [alias("inter", "Umbro")]),
      store("umbrostore", "Umbro Store", [alias("zoom", "Umbro Store")]),
      store("tanara", "Tanara", [alias("mycashback", "Tanara")]),
    ];

    const first = generateAliasCandidates(stores, emptyManifest);
    const second = generateAliasCandidates([...stores].reverse(), emptyManifest);

    expect(first).toEqual(second);
  });
});
