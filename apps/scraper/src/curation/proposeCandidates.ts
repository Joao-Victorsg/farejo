import "dotenv/config";
import { appendFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createClient,
  generateAliasCandidates,
  validateManifestInvariants,
  type AliasCandidate,
  type AliasManifest,
  type AliasRef,
} from "@farejo/shared";
import { resolveSupabaseCredentials } from "../localDb.js";
import { disabledClassifier, type AliasClassifier, type ClassifierCandidateInput, type ClassifierVerdict } from "./aiClassifier.js";
import { fetchCanonicalStores } from "./candidateStores.js";
import { loadAliasManifest } from "./manifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST_PATH = resolve(HERE, "../../../../curation/aliases-manifest.json");
const DEFAULT_REPORT_PATH = resolve(HERE, "../../../../curation/candidates-report.md");

// Veredito de IA só decide (merge ou reject) um candidato ambíguo (levenshtein) acima
// desta confiança; abaixo disso, ou sem IA, o candidato só é reportado (ADR-0039/0040).
const CONFIDENCE_THRESHOLD = 0.75;

export type ProposedDecision =
  | { kind: "merge"; canonicalSlug: string; aliases: AliasRef[] }
  | { kind: "reject"; a: AliasRef; b: AliasRef }
  | { kind: "none" };

export interface CandidateProposal {
  candidate: AliasCandidate;
  verdict: ClassifierVerdict | null;
  decision: ProposedDecision;
}

export function candidateId(candidate: AliasCandidate): string {
  return `${candidate.storeA.canonicalSlug}|${candidate.storeB.canonicalSlug}`;
}

/** Publica a contagem para o workflow decidir se há um PR de revisão a abrir. */
export async function publishCandidateCount(candidateCount: number, githubOutputPath = process.env.GITHUB_OUTPUT): Promise<void> {
  if (!githubOutputPath) return;
  await appendFile(githubOutputPath, `candidate_count=${candidateCount}\n`, "utf8");
}

/**
 * DEFAULT de canônico só para preencher a proposta: a loja com mais aliases confirmadas
 * vence, empate por slug crescente. Nunca é a decisão final — o humano confirma ou
 * corrige antes de mergear o PR (ADR-0006: "o merge não [...] substitui automaticamente
 * por first-writer, score fuzzy ou prioridade implícita de plataforma").
 */
function pickDefaultCanonical(candidate: AliasCandidate): AliasCandidate["storeA"] {
  if (candidate.storeA.aliases.length !== candidate.storeB.aliases.length) {
    return candidate.storeA.aliases.length > candidate.storeB.aliases.length ? candidate.storeA : candidate.storeB;
  }
  return candidate.storeA.canonicalSlug <= candidate.storeB.canonicalSlug ? candidate.storeA : candidate.storeB;
}

/** Único caminho que produz uma proposta `merge` — usado pelo sinal l3_exact e pelo veredito de IA confiante. */
function mergeDecisionFor(candidate: AliasCandidate): ProposedDecision {
  const canonical = pickDefaultCanonical(candidate);
  const other = canonical === candidate.storeA ? candidate.storeB : candidate.storeA;
  return { kind: "merge", canonicalSlug: canonical.canonicalSlug, aliases: [...canonical.aliases, ...other.aliases] };
}

function distinctPlatforms(store: AliasCandidate["storeA"]): string[] {
  return [...new Set(store.aliases.map((alias) => alias.platformId))];
}

export function toClassifierInput(candidate: AliasCandidate): ClassifierCandidateInput {
  return {
    id: candidateId(candidate),
    storeA: { canonicalSlug: candidate.storeA.canonicalSlug, name: candidate.storeA.name, platforms: distinctPlatforms(candidate.storeA) },
    storeB: { canonicalSlug: candidate.storeB.canonicalSlug, name: candidate.storeB.name, platforms: distinctPlatforms(candidate.storeB) },
    normalizedKeyA: candidate.normalizedKeyA,
    normalizedKeyB: candidate.normalizedKeyB,
    signal: candidate.signal,
    similarity: candidate.similarity,
  };
}

/**
 * Política de proposta — determinística sem IA (AC #59):
 * - sinal `l3_exact` (decorador): sempre propõe merge — o único sinal validado sem
 *   colisão intra-site no POC (0/1853 nomes, docs/farejo-recon-e-plano.md).
 * - sinal `levenshtein`: só vira merge/reject com um veredito de IA confiante
 *   (`confidence >= 0.75`); sem IA, ou IA inconclusiva, o candidato fica "none" — só
 *   aparece no relatório para revisão manual, nunca é decidido sozinho.
 */
export function decideProposal(candidate: AliasCandidate, verdict: ClassifierVerdict | null): ProposedDecision {
  if (candidate.signal === "l3_exact") return mergeDecisionFor(candidate);

  if (!verdict || verdict.confidence < CONFIDENCE_THRESHOLD) return { kind: "none" };
  if (verdict.sameStore) return mergeDecisionFor(candidate);

  return { kind: "reject", a: candidate.storeA.aliases[0]!, b: candidate.storeB.aliases[0]! };
}

/**
 * Aplica as decisões propostas ao manifesto uma a uma, checando invariantes
 * (`validateManifestInvariants`) a cada passo — nunca escreve um manifesto que o `curate:apply`
 * pós-merge rejeitaria. Uma proposta que colidiria com outra do mesmo lote (ex.: dois
 * candidatos disputando o mesmo canônico) é descartada e reportada, não silenciada.
 */
export function buildUpdatedManifest(
  manifest: AliasManifest,
  proposals: CandidateProposal[],
): { manifest: AliasManifest; skipped: CandidateProposal[] } {
  let current: AliasManifest = { version: manifest.version, merges: [...manifest.merges], rejects: [...manifest.rejects] };
  const skipped: CandidateProposal[] = [];

  for (const proposal of proposals) {
    if (proposal.decision.kind === "none") continue;

    const candidateManifest: AliasManifest =
      proposal.decision.kind === "merge"
        ? { ...current, merges: [...current.merges, { canonicalSlug: proposal.decision.canonicalSlug, aliases: proposal.decision.aliases }] }
        : { ...current, rejects: [...current.rejects, { a: proposal.decision.a, b: proposal.decision.b }] };

    if (validateManifestInvariants(candidateManifest).length > 0) {
      skipped.push(proposal);
      continue;
    }
    current = candidateManifest;
  }

  return { manifest: current, skipped };
}

/**
 * O canônico de um `merge` é sempre um DEFAULT escolhido por heurística (mais aliases,
 * empate por slug — `pickDefaultCanonical`), nunca uma confirmação humana. O rótulo diz
 * isso explicitamente para não virar um rubber-stamp: revisar o `canonicalSlug` é parte
 * da revisão do PR, não um detalhe implícito (ADR-0006/AC #7 do #59).
 */
function decisionLabel(decision: ProposedDecision): string {
  if (decision.kind === "merge") return `merge → \`${decision.canonicalSlug}\` (canônico escolhido automaticamente — **confirme antes de mergear**)`;
  if (decision.kind === "reject") return "reject";
  return "sem decisão (revisão manual)";
}

export function buildCandidatesReport(proposals: CandidateProposal[], skipped: CandidateProposal[]): string {
  if (proposals.length === 0) return "# Candidatos de alias\n\nNenhum candidato novo nesta execução.\n";

  const skippedIds = new Set(skipped.map((proposal) => candidateId(proposal.candidate)));
  const rows = proposals.map((proposal) => {
    const { candidate, verdict } = proposal;
    const platformsA = distinctPlatforms(candidate.storeA).join(", ");
    const platformsB = distinctPlatforms(candidate.storeB).join(", ");
    const label = skippedIds.has(candidateId(candidate))
      ? "conflito no lote — revisar manualmente"
      : decisionLabel(proposal.decision);
    const verdictText = verdict ? `${verdict.sameStore ? "mesma loja" : "lojas diferentes"} (${verdict.confidence.toFixed(2)}) — ${verdict.explanation}` : "—";
    return `| ${candidate.storeA.name} (\`${candidate.storeA.canonicalSlug}\`, ${platformsA}) | ${candidate.storeB.name} (\`${candidate.storeB.canonicalSlug}\`, ${platformsB}) | ${candidate.signal} | ${candidate.similarity.toFixed(2)} | ${candidate.normalizedKeyA} / ${candidate.normalizedKeyB} | ${verdictText} | ${label} |`;
  });

  return [
    "# Candidatos de alias",
    "",
    "Gerado automaticamente (F3/T13, #59). L2 continua sendo a única identidade — nada aqui vale até um humano revisar e mergear este PR (ADR-0006/ADR-0039).",
    "",
    "**Toda proposta `merge` já vem com um canônico escolhido por heurística (mais aliases, empate por slug), nunca por confirmação humana. Revisar `canonicalSlug` — e corrigi-lo editando este PR se estiver errado — é parte obrigatória da revisão, não um detalhe implícito.**",
    "",
    "| Loja A | Loja B | Sinal | Similaridade | Chaves normalizadas | Veredito IA | Proposta |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const manifest = await loadAliasManifest();
  const { url, key } = resolveSupabaseCredentials();
  const supabase = createClient(url, key);

  const stores = await fetchCanonicalStores(supabase);
  const candidates = generateAliasCandidates(stores, manifest);
  console.log(`[curation] ${candidates.length} candidato(s) novo(s) (stores canônicas: ${stores.length})`);
  await publishCandidateCount(candidates.length);

  if (candidates.length === 0) {
    await writeFile(DEFAULT_REPORT_PATH, buildCandidatesReport([], []), "utf8");
    return;
  }

  const classifier: AliasClassifier = disabledClassifier;
  const verdicts = await classifier(candidates.map(toClassifierInput));
  const verdictById = new Map((verdicts ?? []).map((verdict) => [verdict.id, verdict]));

  const proposals: CandidateProposal[] = candidates.map((candidate) => {
    const verdict = verdictById.get(candidateId(candidate)) ?? null;
    return { candidate, verdict, decision: decideProposal(candidate, verdict) };
  });

  const { manifest: updatedManifest, skipped } = buildUpdatedManifest(manifest, proposals);
  const decided = proposals.filter((proposal) => proposal.decision.kind !== "none" && !skipped.includes(proposal));

  await writeFile(DEFAULT_REPORT_PATH, buildCandidatesReport(proposals, skipped), "utf8");

  if (decided.length === 0) {
    console.log("[curation] nenhuma proposta passou da política determinística — manifesto não alterado");
    return;
  }

  await writeFile(DEFAULT_MANIFEST_PATH, `${JSON.stringify(updatedManifest, null, 2)}\n`, "utf8");
  console.log(`[curation] manifesto atualizado com ${decided.length} proposta(s) (${skipped.length} descartada(s) por conflito no lote)`);
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
