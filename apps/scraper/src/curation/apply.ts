import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createCatalogInvalidator } from "../catalogInvalidation.js";
import { getCurationPool } from "./curationDb.js";
import { loadAliasManifest } from "./manifest.js";

export type DecisionOutcome =
  | { canonicalSlug: string; kind: "merged" | "noop" | "canonical_not_found" }
  | { canonicalSlug: string; kind: "error"; message: string };

/**
 * Aplica cada decisão `merge` do manifesto via `curation.apply_alias_merge`. Falha fechada
 * é POR DECISÃO (ADR-0006): uma decisão que dá exceção (conflito de ofertas) não aborta as
 * demais — cada chamada é sua própria transação, e o restante do manifesto continua sendo
 * aplicado normalmente.
 */
export async function applyManifest(manifestPath?: string): Promise<DecisionOutcome[]> {
  const manifest = await loadAliasManifest(manifestPath);
  const pool = getCurationPool();
  const outcomes: DecisionOutcome[] = [];

  for (const merge of manifest.merges) {
    try {
      const result = await pool.query<{ applied: boolean; reason: string }>(
        "select applied, reason from curation.apply_alias_merge($1, $2)",
        [merge.canonicalSlug, JSON.stringify(merge.aliases)],
      );
      const row = result.rows[0];
      const reason = row?.reason;
      const kind = reason === "merged" || reason === "noop" || reason === "canonical_not_found" ? reason : "error";
      outcomes.push(
        kind === "error"
          ? { canonicalSlug: merge.canonicalSlug, kind, message: `resposta inesperada de apply_alias_merge: ${JSON.stringify(row)}` }
          : { canonicalSlug: merge.canonicalSlug, kind },
      );
    } catch (error) {
      outcomes.push({ canonicalSlug: merge.canonicalSlug, kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return outcomes;
}

async function main(): Promise<void> {
  const outcomes = await applyManifest();

  for (const outcome of outcomes) {
    console.log(outcome.kind === "error" ? `[curation] ${outcome.canonicalSlug}: error — ${outcome.message}` : `[curation] ${outcome.canonicalSlug}: ${outcome.kind}`);
  }

  const merged = outcomes.filter((outcome) => outcome.kind === "merged");
  const failed = outcomes.filter((outcome) => outcome.kind === "error");

  if (merged.length > 0) {
    const invalidate = createCatalogInvalidator();
    await invalidate({ platformId: "curation", runId: 0, timestamp: new Date() });
    console.log(`[curation] catalog invalidated (${merged.length} decisão(ões) aplicada(s))`);
  }

  if (failed.length > 0) {
    console.error(`[curation] ${failed.length} decisão(ões) falharam`);
    process.exitCode = 1;
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
