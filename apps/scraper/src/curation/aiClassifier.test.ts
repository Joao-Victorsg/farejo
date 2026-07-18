import { describe, expect, it, vi } from "vitest";
import { createHttpClassifier, disabledClassifier, type ClassifierCandidateInput } from "./aiClassifier.js";

const candidate: ClassifierCandidateInput = {
  id: "nike|nikestore",
  storeA: { canonicalSlug: "nike", name: "Nike", platforms: ["inter"] },
  storeB: { canonicalSlug: "nikestore", name: "Nike Store", platforms: ["cuponomia"] },
  normalizedKeyA: "nike",
  normalizedKeyB: "nike",
  signal: "l3_exact",
  similarity: 1,
};

describe("disabledClassifier", () => {
  it("always resolves to null (no provider connected)", async () => {
    await expect(disabledClassifier([candidate])).resolves.toBeNull();
  });
});

describe("createHttpClassifier", () => {
  it("returns the parsed verdicts on a well-formed response", async () => {
    const requestJson = vi.fn().mockResolvedValue([{ id: "nike|nikestore", sameStore: true, confidence: 0.9, explanation: "mesma marca, decorador removido" }]);
    const classifier = createHttpClassifier(requestJson);

    const verdicts = await classifier([candidate]);

    expect(verdicts).toEqual([{ id: "nike|nikestore", sameStore: true, confidence: 0.9, explanation: "mesma marca, decorador removido" }]);
  });

  it("returns an empty array without calling the transport when there are no candidates", async () => {
    const requestJson = vi.fn();
    const classifier = createHttpClassifier(requestJson);

    await expect(classifier([])).resolves.toEqual([]);
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("falls back to null on a schema-invalid response instead of throwing (resposta IA inválida)", async () => {
    const requestJson = vi.fn().mockResolvedValue([{ id: "nike|nikestore", sameStore: "yes", confidence: 2, explanation: "" }]);
    const classifier = createHttpClassifier(requestJson);

    await expect(classifier([candidate])).resolves.toBeNull();
  });

  it("falls back to null when the response is not an array at all", async () => {
    const requestJson = vi.fn().mockResolvedValue({ error: "rate limited" });
    const classifier = createHttpClassifier(requestJson);

    await expect(classifier([candidate])).resolves.toBeNull();
  });

  it("falls back to null when the transport throws (quota/indisponibilidade)", async () => {
    const requestJson = vi.fn().mockRejectedValue(new Error("HTTP 429"));
    const classifier = createHttpClassifier(requestJson);

    await expect(classifier([candidate])).resolves.toBeNull();
  });
});
