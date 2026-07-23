import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AliasCandidate, AliasManifest, AliasRef } from "@farejo/shared";
import { describe, expect, it } from "vitest";
import type { ClassifierVerdict } from "./aiClassifier.js";
import { buildCandidatesReport, buildUpdatedManifest, candidateId, decideProposal, publishCandidateCount, type CandidateProposal } from "./proposeCandidates.js";

const alias = (platformId: string, rawName: string): AliasRef => ({ platformId, rawName });
const emptyManifest: AliasManifest = { version: 1, merges: [], rejects: [] };

function l3Candidate(): AliasCandidate {
  return {
    storeA: { canonicalSlug: "clinique", name: "Clinique", aliases: [alias("inter", "Clinique")] },
    storeB: {
      canonicalSlug: "cliniquebrasil",
      name: "Clinique Brasil",
      aliases: [alias("cuponomia", "Clinique Brasil"), alias("zoom", "Clinique BR")],
    },
    normalizedKeyA: "clinique",
    normalizedKeyB: "clinique",
    signal: "l3_exact",
    similarity: 1,
    evidence: "mesma chave L3 (decorador removido) com slugs L2 diferentes",
  };
}

function levenshteinCandidate(): AliasCandidate {
  return {
    storeA: { canonicalSlug: "tanara", name: "Tanara", aliases: [alias("inter", "Tanara")] },
    storeB: { canonicalSlug: "tanaraa", name: "Tanaraa", aliases: [alias("cuponomia", "Tanaraa")] },
    normalizedKeyA: "tanara",
    normalizedKeyB: "tanaraa",
    signal: "levenshtein",
    similarity: 0.9,
    evidence: "distância de Levenshtein entre slugs: similaridade 0.90",
  };
}

describe("decideProposal", () => {
  it("proposes merge for an l3_exact candidate regardless of AI", () => {
    const decision = decideProposal(l3Candidate(), null);
    expect(decision.kind).toBe("merge");
  });

  it("picks the store with more aliases as the default canonical for l3_exact", () => {
    const decision = decideProposal(l3Candidate(), null);
    expect(decision).toMatchObject({ kind: "merge", canonicalSlug: "cliniquebrasil" });
    if (decision.kind === "merge") {
      expect(decision.aliases).toEqual(expect.arrayContaining([alias("inter", "Clinique"), alias("cuponomia", "Clinique Brasil"), alias("zoom", "Clinique BR")]));
    }
  });

  it("proposes nothing for a levenshtein candidate without an AI verdict (deterministic without AI)", () => {
    expect(decideProposal(levenshteinCandidate(), null)).toEqual({ kind: "none" });
  });

  it("proposes nothing for a levenshtein candidate with a low-confidence verdict", () => {
    const verdict: ClassifierVerdict = { id: "x", sameStore: true, confidence: 0.4, explanation: "incerto" };
    expect(decideProposal(levenshteinCandidate(), verdict)).toEqual({ kind: "none" });
  });

  it("proposes merge for a levenshtein candidate with a confident same-store verdict", () => {
    const verdict: ClassifierVerdict = { id: "x", sameStore: true, confidence: 0.9, explanation: "mesma marca" };
    expect(decideProposal(levenshteinCandidate(), verdict).kind).toBe("merge");
  });

  it("proposes reject for a levenshtein candidate with a confident different-store verdict", () => {
    const verdict: ClassifierVerdict = { id: "x", sameStore: false, confidence: 0.9, explanation: "marcas diferentes" };
    const decision = decideProposal(levenshteinCandidate(), verdict);
    expect(decision).toEqual({ kind: "reject", a: alias("inter", "Tanara"), b: alias("cuponomia", "Tanaraa") });
  });
});

describe("buildUpdatedManifest", () => {
  it("adds a merge proposal to the manifest", () => {
    const proposal: CandidateProposal = { candidate: l3Candidate(), verdict: null, decision: decideProposal(l3Candidate(), null) };

    const { manifest, skipped } = buildUpdatedManifest(emptyManifest, [proposal]);

    expect(skipped).toEqual([]);
    expect(manifest.merges).toHaveLength(1);
  });

  it("skips (never silently drops) a proposal that would violate manifest invariants", () => {
    const candidate = l3Candidate();
    const decision = decideProposal(candidate, null);
    const proposal: CandidateProposal = { candidate, verdict: null, decision };

    // O manifesto já tem uma decisão conflitante prévia: mesmo canonicalSlug já reivindicado
    // por outro cluster — aplicar a proposta violaria duplicate_canonical_slug.
    const manifestWithConflict: AliasManifest = {
      version: 1,
      merges: [{ canonicalSlug: "cliniquebrasil", aliases: [alias("mycashback", "Outra Clinique")] }],
      rejects: [],
    };

    const { manifest, skipped } = buildUpdatedManifest(manifestWithConflict, [proposal]);

    expect(skipped).toEqual([proposal]);
    expect(manifest.merges).toHaveLength(1);
  });

  it("never proposes anything for a candidate whose decision is 'none'", () => {
    const candidate = levenshteinCandidate();
    const proposal: CandidateProposal = { candidate, verdict: null, decision: { kind: "none" } };

    const { manifest, skipped } = buildUpdatedManifest(emptyManifest, [proposal]);

    expect(skipped).toEqual([]);
    expect(manifest).toEqual(emptyManifest);
  });
});

describe("buildCandidatesReport", () => {
  it("is deterministic and mentions every candidate, decided or not", () => {
    const candidate = l3Candidate();
    const proposal: CandidateProposal = { candidate, verdict: null, decision: decideProposal(candidate, null) };

    const first = buildCandidatesReport([proposal], []);
    const second = buildCandidatesReport([proposal], []);

    expect(first).toBe(second);
    expect(first).toContain("Clinique");
    expect(first).toContain("Clinique Brasil");
    expect(first).toContain("l3_exact");
  });

  it("labels a skipped candidate as a batch conflict instead of hiding it", () => {
    const candidate = l3Candidate();
    const proposal: CandidateProposal = { candidate, verdict: null, decision: decideProposal(candidate, null) };

    const report = buildCandidatesReport([proposal], [proposal]);

    expect(report).toContain("conflito no lote");
  });

  it("reports 'no candidates' when the list is empty", () => {
    expect(buildCandidatesReport([], [])).toContain("Nenhum candidato novo");
  });
});

describe("candidateId", () => {
  it("is stable regardless of which side is storeA/storeB", () => {
    const candidate = l3Candidate();
    expect(candidateId(candidate)).toBe("clinique|cliniquebrasil");
  });
});

describe("publishCandidateCount", () => {
  it("publishes a positive candidate count for the workflow to decide whether a review PR is needed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "farejo-curation-"));
    const githubOutputPath = join(directory, "github-output");

    try {
      await publishCandidateCount(1, githubOutputPath);

      expect(await readFile(githubOutputPath, "utf8")).toBe("candidate_count=1\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
