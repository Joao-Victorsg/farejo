import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localSupabaseClient } from "../testDb.js";
import { fetchCanonicalStores } from "./candidateStores.js";

const client = localSupabaseClient();

// Plataformas de teste isoladas das 5 reais, como em pipeline/store.test.ts (T7).
const PLATFORM_A = "test-t13-a";
const PLATFORM_B = "test-t13-b";
const SLUG_PREFIX = "test-t13-candidatestores-";

describe("fetchCanonicalStores (Postgres local)", () => {
  beforeAll(async () => {
    const { error } = await client.from("platforms").upsert([
      { id: PLATFORM_A, name: "Test T13 A", base_url: "https://a.test" },
      { id: PLATFORM_B, name: "Test T13 B", base_url: "https://b.test" },
    ]);
    if (error) throw error;
  });

  afterAll(async () => {
    const { data: stores } = await client.from("stores").select("id").like("slug", `${SLUG_PREFIX}%`);
    const storeIds = (stores ?? []).map((s) => s.id);
    if (storeIds.length > 0) {
      await client.from("store_aliases").delete().in("store_id", storeIds);
      await client.from("stores").delete().in("id", storeIds);
    }
    await client.from("platforms").delete().in("id", [PLATFORM_A, PLATFORM_B]);
  });

  it("groups every alias of a canonical store, across platforms, into a single view", async () => {
    const { data: store, error } = await client
      .from("stores")
      .insert({ slug: `${SLUG_PREFIX}multiplatform`, name: "Multiplatform Test T13" })
      .select("id")
      .single();
    if (error) throw error;

    await client.from("store_aliases").insert([
      { platform_id: PLATFORM_A, raw_name: "Multiplatform A", store_id: store.id, confidence: "auto" },
      { platform_id: PLATFORM_B, raw_name: "Multiplatform B", store_id: store.id, confidence: "auto" },
    ]);

    const views = await fetchCanonicalStores(client);
    const view = views.find((v) => v.canonicalSlug === `${SLUG_PREFIX}multiplatform`);

    expect(view).toBeDefined();
    expect(view?.name).toBe("Multiplatform Test T13");
    expect(view?.aliases).toEqual(
      expect.arrayContaining([
        { platformId: PLATFORM_A, rawName: "Multiplatform A" },
        { platformId: PLATFORM_B, rawName: "Multiplatform B" },
      ]),
    );
  });

  it("excludes a canonical store with no alias rows at all", async () => {
    const { error } = await client.from("stores").insert({ slug: `${SLUG_PREFIX}orphan`, name: "Orphan Test T13" });
    if (error) throw error;

    const views = await fetchCanonicalStores(client);

    expect(views.some((v) => v.canonicalSlug === `${SLUG_PREFIX}orphan`)).toBe(false);
  });
});
