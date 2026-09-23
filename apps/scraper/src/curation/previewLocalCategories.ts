import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { z } from "zod";
import { CategoryManifest } from "./categoryManifest.js";

const Pilot = z.object({
  taxonomy: z.array(z.object({ slug: z.string(), name: z.string() })),
  stores: z.array(z.object({
    canonical_slug: z.string(),
    review_priority: z.string(),
    category_associations: z.array(z.object({ category_slug: z.string(), source_ids: z.array(z.string()) })).optional(),
  })),
  sources: z.array(z.object({
    id: z.string(), url: z.string(), summary: z.string(), consulted_on_local: z.string(),
    kind: z.string(), supports: z.array(z.string()),
  })),
});

const icons = new Map([
  ["alimentos-bebidas", "utensils"], ["moda-acessorios", "shirt"], ["beleza-cuidados", "sparkles"],
  ["saude-bem-estar", "heart-pulse"], ["eletronicos-informatica", "laptop"], ["casa-jardim", "house"],
  ["esportes-fitness", "dumbbell"], ["pets", "paw-print"], ["viagens-turismo", "plane"],
  ["livros-educacao", "book-open"], ["software-digital", "monitor"], ["entretenimento-games", "gamepad-2"],
  ["automotivo", "car"], ["presentes-flores", "gift"], ["financas-seguros", "landmark"],
  ["telefonia-internet", "wifi"],
]);

const raw = JSON.parse(await readFile(resolve(import.meta.dirname, "../../../../docs/research/categorias-piloto-2026-09-09/dados.json"), "utf8"));
const pilot = Pilot.parse(raw);
const client = new Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });
await client.connect();
try {
  const slugs = pilot.stores.filter((store) => store.review_priority === "normal").map((store) => store.canonical_slug);
  const present = new Set((await client.query<{ slug: string }>("select slug from public.stores where slug = any($1)", [slugs])).rows.map((row) => row.slug));
  const sources = new Map(pilot.sources.map((source) => [source.id, source]));
  const stores = pilot.stores.filter((store) => store.review_priority === "normal" && present.has(store.canonical_slug)).map((store) => ({
    slug: store.canonical_slug,
    categories: (store.category_associations ?? []).flatMap((association) => {
      const evidence = association.source_ids.flatMap((id) => {
        const source = sources.get(id);
        if (!source || !["site_oficial", "controladora"].includes(source.kind) || !source.supports.includes(association.category_slug)) return [];
        return [{ url: source.url, observedAt: source.consulted_on_local, note: source.summary }];
      });
      return evidence.length ? [{ slug: association.category_slug, evidence }] : [];
    }),
  })).filter((store) => store.categories.length > 0);
  const manifest = CategoryManifest.parse({
    version: 1, status: "approved",
    categories: pilot.taxonomy.map((category, index) => ({ slug: category.slug, name: category.name, icon: icons.get(category.slug), position: index, active: true })),
    stores,
  });
  await client.query("begin");
  try {
    await client.query("set local role farejo_curation");
    const result = await client.query("select * from curation.apply_category_manifest($1)", [manifest]);
    const verified = await client.query("select curation.verify_category_manifest($1) as valid", [manifest]);
    if (verified.rows[0]?.valid !== true) throw new Error("Local category verification failed");
    await client.query("commit");
    console.log({ localPreview: true, stores: stores.length, associations: stores.reduce((sum, store) => sum + store.categories.length, 0), result: result.rows[0] });
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
} finally {
  await client.end();
}
