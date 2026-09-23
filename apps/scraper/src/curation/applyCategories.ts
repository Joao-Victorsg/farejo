import "dotenv/config";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createCatalogInvalidator } from "../catalogInvalidation.js";
import { getCurationPool } from "./curationDb.js";
import { loadCategoryManifest, type CategoryManifest } from "./categoryManifest.js";

const StateRow = z.object({ input_slug: z.string(), canonical_slug: z.string().nullable(), categories: z.array(z.object({ slug: z.string(), evidence: z.array(z.unknown()) })) });
type StateRow = z.infer<typeof StateRow>;

export type CategoryChange = { slug: string; canonicalSlug: string; before: string[]; after: string[] };

function changes(before: StateRow[], after: StateRow[]): CategoryChange[] {
  const old = new Map(before.map((row) => [row.input_slug, row]));
  return after.flatMap((row) => {
    const previous = old.get(row.input_slug);
    const oldCategories = previous?.categories.map((entry) => entry.slug) ?? [];
    const newCategories = row.categories.map((entry) => entry.slug);
    if (JSON.stringify(previous?.categories) === JSON.stringify(row.categories)) return [];
    return [{ slug: row.input_slug, canonicalSlug: row.canonical_slug ?? row.input_slug, before: oldCategories, after: newCategories }];
  });
}

export async function applyCategories(manifest: CategoryManifest, apply: boolean) {
  const client = await getCurationPool().connect();
  let inTransaction = false;
  try {
    await client.query("begin");
    inTransaction = true;
    await client.query("set local statement_timeout = '120s'");
    await client.query("select pg_advisory_xact_lock(hashtextextended('farejo-curation', 0))");
    const slugs = manifest.stores.map((store) => store.slug);
    const before = z.array(StateRow).parse((await client.query("select * from curation.category_state($1)", [slugs])).rows);
    const result = await client.query<{ applied: boolean; revision_hash: string }>("select * from curation.apply_category_manifest($1)", [JSON.stringify(manifest)]);
    const outcome = result.rows[0];
    if (!outcome) throw new Error("Category application returned no result");
    const verified = await client.query<{ valid: boolean }>("select curation.verify_category_manifest($1) as valid", [JSON.stringify(manifest)]);
    if (verified.rows[0]?.valid !== true) throw new Error("Category materialized state differs from manifest");
    const after = z.array(StateRow).parse((await client.query("select * from curation.category_state($1)", [slugs])).rows);
    const diff = changes(before, after);
    await client.query(apply ? "commit" : "rollback");
    inTransaction = false;
    return { ...outcome, changes: diff, committed: apply };
  } catch (error) {
    if (inTransaction) await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const paths = args.filter((arg) => arg !== "--apply" && arg !== "--dry-run");
  if (paths.length > 1 || (apply && args.includes("--dry-run")) || paths.some((path) => path.startsWith("--"))) {
    throw new Error("Usage: curate:categories [--dry-run | --apply] [manifest-path]");
  }
  const manifest = await loadCategoryManifest(paths[0]);
  const pool = getCurationPool();
  try {
    const outcome = await applyCategories(manifest, apply);
    console.log(JSON.stringify(outcome, null, 2));
    if (apply) {
      // Repetir a invalidação num noop recupera uma tentativa anterior que gravou no banco mas perdeu a notificação.
      await createCatalogInvalidator()({ platformId: "categories", runId: 0, timestamp: new Date() });
      console.log("[categories] catalog invalidated");
    }
  } finally {
    await pool.end();
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isMain) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
