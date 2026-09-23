import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const evidence = z.object({
  url: z.string().url().refine((value) => value.startsWith("https://") || value.startsWith("http://")),
  observedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }),
  note: z.string().trim().min(1),
}).strict();

const category = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(80),
  icon: z.enum(["shirt", "house", "laptop", "sparkles", "utensils", "heart-pulse", "dumbbell", "paw-print", "plane", "book-open", "gamepad-2", "monitor", "car", "gift", "landmark", "wifi"]),
  position: z.number().int().nonnegative(),
  active: z.boolean(),
}).strict();

const association = z.object({ slug: category.shape.slug, evidence: z.array(evidence).min(1) }).strict();
const store = z.object({ slug: category.shape.slug, categories: z.array(association) }).strict();

export const CategoryManifest = z.object({
  version: z.literal(1),
  status: z.literal("approved"),
  categories: z.array(category).min(1),
  stores: z.array(store),
}).strict().superRefine((manifest, context) => {
  const categorySlugs = new Set<string>();
  const positions = new Set<number>();
  for (const [index, item] of manifest.categories.entries()) {
    if (categorySlugs.has(item.slug)) context.addIssue({ code: "custom", path: ["categories", index, "slug"], message: "Duplicate category" });
    if (positions.has(item.position)) context.addIssue({ code: "custom", path: ["categories", index, "position"], message: "Duplicate position" });
    categorySlugs.add(item.slug);
    positions.add(item.position);
  }
  const storeSlugs = new Set<string>();
  for (const [index, item] of manifest.stores.entries()) {
    if (storeSlugs.has(item.slug)) context.addIssue({ code: "custom", path: ["stores", index, "slug"], message: "Duplicate store" });
    storeSlugs.add(item.slug);
    const associations = new Set<string>();
    for (const [associationIndex, entry] of item.categories.entries()) {
      if (!categorySlugs.has(entry.slug)) context.addIssue({ code: "custom", path: ["stores", index, "categories", associationIndex, "slug"], message: "Unknown category" });
      if (associations.has(entry.slug)) context.addIssue({ code: "custom", path: ["stores", index, "categories", associationIndex, "slug"], message: "Duplicate association" });
      associations.add(entry.slug);
    }
  }
});

export type CategoryManifest = z.infer<typeof CategoryManifest>;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const defaultPath = resolve(projectRoot, "curation/categories-manifest.json");

export async function loadCategoryManifest(path: string = defaultPath): Promise<CategoryManifest> {
  const raw = await readFile(resolve(projectRoot, path), "utf8");
  return CategoryManifest.parse(JSON.parse(raw));
}
