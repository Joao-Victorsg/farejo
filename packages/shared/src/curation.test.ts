import { describe, expect, it } from "vitest";
import { AliasManifestSchema, parseAliasManifest, validateManifestInvariants, type AliasManifest, type AliasRef } from "./curation.js";

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
