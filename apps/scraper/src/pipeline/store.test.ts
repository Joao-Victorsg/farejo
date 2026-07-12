import "dotenv/config";
import { createClient, l2Key } from "@farejo/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findOrCreateStore } from "./store.js";

// Mesmas chaves do stack local usadas em apps/scraper/src/db.test.ts.
const LOCAL_URL = "http://127.0.0.1:55321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const client = createClient(
  process.env.SUPABASE_URL ?? LOCAL_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? LOCAL_SERVICE_ROLE_KEY,
);

// Plataformas de teste isoladas das 5 reais (meliuz/cuponomia/mycashback/zoom/inter) para
// não sujar o dicionário de aliases de produção local. Limpas em afterAll.
const PLATFORM_A = "test-t7-a";
const PLATFORM_B = "test-t7-b";

describe("findOrCreateStore (Postgres local)", () => {
  beforeAll(async () => {
    const { error } = await client.from("platforms").upsert([
      { id: PLATFORM_A, name: "Test T7 A", base_url: "https://a.test" },
      { id: PLATFORM_B, name: "Test T7 B", base_url: "https://b.test" },
    ]);
    if (error) throw error;
  });

  afterAll(async () => {
    const { data: aliases } = await client
      .from("store_aliases")
      .select("store_id")
      .in("platform_id", [PLATFORM_A, PLATFORM_B]);
    const storeIds = [...new Set((aliases ?? []).map((a) => a.store_id).filter((id) => id != null))];

    await client.from("store_aliases").delete().in("platform_id", [PLATFORM_A, PLATFORM_B]);
    if (storeIds.length > 0) await client.from("stores").delete().in("id", storeIds);
    await client.from("platforms").delete().in("id", [PLATFORM_A, PLATFORM_B]);
  });

  it("creates a new canonical store + auto alias for a brand-new raw name (layer 5)", async () => {
    const rawName = "Nike Test T7";
    const result = await findOrCreateStore(client, PLATFORM_A, rawName);

    expect(result.anomaly).toBeNull();

    const { data: store } = await client.from("stores").select("*").eq("id", result.storeId).single();
    expect(store).toMatchObject({ slug: l2Key(rawName), name: rawName });

    const { data: alias } = await client
      .from("store_aliases")
      .select("*")
      .eq("platform_id", PLATFORM_A)
      .eq("raw_name", rawName)
      .single();
    expect(alias).toMatchObject({ store_id: result.storeId, confidence: "auto" });
  });

  it("reuses the existing alias on a repeat call instead of creating a duplicate (layer 2)", async () => {
    const rawName = "Repeat Test T7";
    const first = await findOrCreateStore(client, PLATFORM_A, rawName);
    const second = await findOrCreateStore(client, PLATFORM_A, rawName);

    expect(second.storeId).toBe(first.storeId);
    expect(second.anomaly).toBeNull();

    const { data: aliases } = await client
      .from("store_aliases")
      .select("*")
      .eq("platform_id", PLATFORM_A)
      .eq("raw_name", rawName);
    expect(aliases).toHaveLength(1);
  });

  it("converges the same L2 key from different platforms onto the same canonical store (layer 3)", async () => {
    const first = await findOrCreateStore(client, PLATFORM_A, "Converge Test T7");
    const second = await findOrCreateStore(client, PLATFORM_B, "converge-test-t7.com.br");

    expect(second.storeId).toBe(first.storeId);
    expect(second.anomaly).toBeNull();

    const { data: stores } = await client.from("stores").select("*").eq("slug", l2Key("Converge Test T7"));
    expect(stores).toHaveLength(1);
  });

  it("never overwrites the canonical name once first written (first-writer-wins)", async () => {
    const first = await findOrCreateStore(client, PLATFORM_A, "Firstname Test T7");
    await findOrCreateStore(client, PLATFORM_B, "FIRSTNAME   Test T7");

    const { data: store } = await client.from("stores").select("name").eq("id", first.storeId).single();
    expect(store?.name).toBe("Firstname Test T7");
  });

  it("reports (but does not silence) an intra-platform L2 collision", async () => {
    const first = await findOrCreateStore(client, PLATFORM_A, "Collide Test T7");
    const second = await findOrCreateStore(client, PLATFORM_A, "collide-test-t7.com.br");

    expect(second.storeId).toBe(first.storeId);
    expect(second.anomaly).toMatchObject({
      platformId: PLATFORM_A,
      storeId: first.storeId,
    });
    expect(second.anomaly?.rawNames).toEqual(
      expect.arrayContaining(["Collide Test T7", "collide-test-t7.com.br"]),
    );

    // As duas aliases coexistem — a colisão é logada, não bloqueia a segunda.
    const { data: aliases } = await client
      .from("store_aliases")
      .select("raw_name")
      .eq("platform_id", PLATFORM_A)
      .eq("store_id", first.storeId);
    expect(aliases).toHaveLength(2);
  });
});
