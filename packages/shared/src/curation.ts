import { z } from "zod";
import { l3Key } from "./normalize.js";
import { levenshteinRatio } from "./similarity.js";

/**
 * Manifesto de curadoria de aliases (ADR-0006): decisões humanas versionadas no Git,
 * identificadas por plataforma + nome cru + slug canônico — nunca por `stores.id`, que
 * pode variar entre ambientes. `merge` associa nomes crus a uma loja canônica explícita;
 * `reject` memoriza que um par já foi revisado e não deve ser reproposto pelo fuzzy/IA.
 */
export const AliasRefSchema = z.object({
  platformId: z.string().min(1),
  rawName: z.string().min(1),
});
export type AliasRef = z.infer<typeof AliasRefSchema>;

export const AliasMergeDecisionSchema = z.object({
  canonicalSlug: z.string().min(1),
  aliases: z.array(AliasRefSchema).min(1),
});
export type AliasMergeDecision = z.infer<typeof AliasMergeDecisionSchema>;

export const AliasRejectDecisionSchema = z.object({
  a: AliasRefSchema,
  b: AliasRefSchema,
});
export type AliasRejectDecision = z.infer<typeof AliasRejectDecisionSchema>;

export const AliasManifestSchema = z.object({
  version: z.literal(1),
  merges: z.array(AliasMergeDecisionSchema).default([]),
  rejects: z.array(AliasRejectDecisionSchema).default([]),
});
export type AliasManifest = z.infer<typeof AliasManifestSchema>;

export function parseAliasManifest(json: unknown): AliasManifest {
  return AliasManifestSchema.parse(json);
}

export type ManifestInvariantViolation =
  | { kind: "duplicate_canonical_slug"; canonicalSlug: string }
  | { kind: "duplicate_alias_claim"; alias: AliasRef; canonicalSlugs: [string, string] }
  | { kind: "reject_merge_contradiction"; pair: [AliasRef, AliasRef]; canonicalSlug: string };

function aliasKey(ref: AliasRef): string {
  return `${ref.platformId} ${ref.rawName}`;
}

/**
 * Invariantes checáveis só a partir do texto do manifesto, sem consultar o Postgres —
 * a checagem que precisa do estado real (ex.: duas ofertas da mesma plataforma após o
 * merge) é responsabilidade de `curation.apply_alias_merge`, não desta função.
 */
export function validateManifestInvariants(manifest: AliasManifest): ManifestInvariantViolation[] {
  const violations: ManifestInvariantViolation[] = [];
  const claimedBy = new Map<string, { alias: AliasRef; canonicalSlug: string }>();
  const seenCanonicalSlugs = new Set<string>();

  for (const merge of manifest.merges) {
    if (seenCanonicalSlugs.has(merge.canonicalSlug)) {
      violations.push({ kind: "duplicate_canonical_slug", canonicalSlug: merge.canonicalSlug });
    }
    seenCanonicalSlugs.add(merge.canonicalSlug);

    for (const alias of merge.aliases) {
      const key = aliasKey(alias);
      const existing = claimedBy.get(key);
      if (existing && existing.canonicalSlug !== merge.canonicalSlug) {
        violations.push({ kind: "duplicate_alias_claim", alias, canonicalSlugs: [existing.canonicalSlug, merge.canonicalSlug] });
      }
      claimedBy.set(key, { alias, canonicalSlug: merge.canonicalSlug });
    }
  }

  for (const reject of manifest.rejects) {
    const claimA = claimedBy.get(aliasKey(reject.a));
    const claimB = claimedBy.get(aliasKey(reject.b));
    if (claimA && claimB && claimA.canonicalSlug === claimB.canonicalSlug) {
      violations.push({ kind: "reject_merge_contradiction", pair: [reject.a, reject.b], canonicalSlug: claimA.canonicalSlug });
    }
  }

  return violations;
}

/**
 * F3/T13 (#59, ADR-0006/ADR-0039): geração de candidatos de alias — nunca identidade.
 * L2 (`stores.slug`) é a única chave que decide o que é a mesma loja no pipeline; L3,
 * trigram/Levenshtein e IA só sugerem pares para a revisão humana no manifesto.
 */
export interface CanonicalStoreView {
  canonicalSlug: string;
  name: string;
  /** Todos os nomes crus (todas as plataformas) que hoje apontam para esta loja canônica. */
  aliases: AliasRef[];
}

export type AliasCandidateSignal = "l3_exact" | "levenshtein";

export interface AliasCandidate {
  storeA: CanonicalStoreView;
  storeB: CanonicalStoreView;
  normalizedKeyA: string;
  normalizedKeyB: string;
  signal: AliasCandidateSignal;
  similarity: number;
  evidence: string;
}

function normalizedKeyFor(store: CanonicalStoreView, signal: AliasCandidateSignal): string {
  return signal === "l3_exact" ? l3Key(store.name) : store.canonicalSlug;
}

/** Um site nunca lista a mesma loja duas vezes com nomes diferentes — não é um candidato de alias. */
function isSameSinglePlatform(storeA: CanonicalStoreView, storeB: CanonicalStoreView): boolean {
  return (
    storeA.aliases.length === 1 &&
    storeB.aliases.length === 1 &&
    storeA.aliases[0]!.platformId === storeB.aliases[0]!.platformId
  );
}

/** Um `reject` já registrado suprime o mesmo falso positivo em execuções futuras (ADR-0006). */
function isPairRejected(manifest: AliasManifest, storeA: CanonicalStoreView, storeB: CanonicalStoreView): boolean {
  const aKeys = new Set(storeA.aliases.map(aliasKey));
  const bKeys = new Set(storeB.aliases.map(aliasKey));
  return manifest.rejects.some((reject) => {
    const rejectA = aliasKey(reject.a);
    const rejectB = aliasKey(reject.b);
    return (aKeys.has(rejectA) && bKeys.has(rejectB)) || (aKeys.has(rejectB) && bKeys.has(rejectA));
  });
}

/** Já existe uma decisão `merge` pendente/aplicada cobrindo este par — não reproposta. */
function isPairAlreadyMerged(manifest: AliasManifest, storeA: CanonicalStoreView, storeB: CanonicalStoreView): boolean {
  const aKeys = new Set(storeA.aliases.map(aliasKey));
  const bKeys = new Set(storeB.aliases.map(aliasKey));
  return manifest.merges.some((merge) => {
    if (merge.canonicalSlug !== storeA.canonicalSlug && merge.canonicalSlug !== storeB.canonicalSlug) return false;
    const mergeKeys = new Set(merge.aliases.map(aliasKey));
    const otherSideKeys = merge.canonicalSlug === storeA.canonicalSlug ? bKeys : aKeys;
    return [...otherSideKeys].some((key) => mergeKeys.has(key));
  });
}

function describeEvidence(signal: AliasCandidateSignal, similarity: number): string {
  return signal === "l3_exact"
    ? "mesma chave L3 (decorador removido) com slugs L2 diferentes"
    : `distância de Levenshtein entre slugs: similaridade ${similarity.toFixed(2)}`;
}

/**
 * Gera candidatos de alias cross-loja a partir do estado canônico atual (`stores` +
 * `store_aliases`, já convergido pela L2) e do manifesto vigente. Determinístico: mesma
 * entrada produz sempre a mesma lista, na mesma ordem — não depende de IA.
 *
 * Portado de docs/poc/src/normalize.ts (09/07/2026), validado sem colisão intra-site em
 * 1853 nomes: sinal "decorador" (L3) e sinal "levenshtein" (slug L2, prefixo/tamanho
 * próximos, razão ≥0,88).
 */
export function generateAliasCandidates(stores: CanonicalStoreView[], manifest: AliasManifest): AliasCandidate[] {
  const candidates = new Map<string, AliasCandidate>();

  function tryAdd(storeA: CanonicalStoreView, storeB: CanonicalStoreView, signal: AliasCandidateSignal, similarity: number): void {
    if (storeA.canonicalSlug === storeB.canonicalSlug) return;
    const [x, y] = storeA.canonicalSlug < storeB.canonicalSlug ? [storeA, storeB] : [storeB, storeA];
    const id = `${x.canonicalSlug}|${y.canonicalSlug}`;
    if (candidates.has(id)) return;
    if (isSameSinglePlatform(x, y)) return;
    if (isPairRejected(manifest, x, y)) return;
    if (isPairAlreadyMerged(manifest, x, y)) return;

    candidates.set(id, {
      storeA: x,
      storeB: y,
      signal,
      similarity,
      normalizedKeyA: normalizedKeyFor(x, signal),
      normalizedKeyB: normalizedKeyFor(y, signal),
      evidence: describeEvidence(signal, similarity),
    });
  }

  const byL3Key = new Map<string, CanonicalStoreView[]>();
  for (const store of stores) {
    const key = l3Key(store.name);
    const group = byL3Key.get(key);
    if (group) group.push(store);
    else byL3Key.set(key, [store]);
  }
  for (const group of byL3Key.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) tryAdd(group[i]!, group[j]!, "l3_exact", 1);
    }
  }

  const bySlug = [...stores].sort((a, b) => a.canonicalSlug.localeCompare(b.canonicalSlug));
  for (let i = 0; i < bySlug.length; i++) {
    for (let j = i + 1; j < bySlug.length; j++) {
      const a = bySlug[i]!.canonicalSlug;
      const b = bySlug[j]!.canonicalSlug;
      if (a.length < 5 || a[0] !== b[0] || Math.abs(a.length - b.length) > 2) continue;
      const similarity = levenshteinRatio(a, b);
      if (similarity >= 0.88) tryAdd(bySlug[i]!, bySlug[j]!, "levenshtein", similarity);
    }
  }

  return [...candidates.values()].sort((left, right) => {
    if (right.similarity !== left.similarity) return right.similarity - left.similarity;
    const leftId = `${left.storeA.canonicalSlug}|${left.storeB.canonicalSlug}`;
    const rightId = `${right.storeA.canonicalSlug}|${right.storeB.canonicalSlug}`;
    return leftId.localeCompare(rightId);
  });
}
