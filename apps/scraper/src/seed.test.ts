import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedCrawlStateSlugs } from "./seed.js";
import { localSupabaseClient } from "./testDb.js";

const client = localSupabaseClient();
const PLATFORM_ID = "test-t24-seed";

describe("seedCrawlStateSlugs (T12/#24, Postgres local)", () => {
  beforeAll(async () => {
    const { error } = await client
      .from("platforms")
      .upsert({ id: PLATFORM_ID, name: "Test T24 seed", base_url: "https://t24-seed.test" });
    if (error) throw error;
  });

  afterAll(async () => {
    await client.from("crawl_state").delete().eq("platform_id", PLATFORM_ID);
    await client.from("platforms").delete().eq("id", PLATFORM_ID);
  });

  it("insere slugs novos como tail/não-visitados e preserva os já processados ao reexecutar", async () => {
    await seedCrawlStateSlugs(client, PLATFORM_ID, ["loja-um", "loja-dois"]);

    const checkedAt = "2026-07-13T00:00:00Z";
    const { error: updateError } = await client
      .from("crawl_state")
      .update({ tier: "active", last_checked_at: checkedAt, last_outcome: "offer" })
      .eq("platform_id", PLATFORM_ID)
      .eq("slug", "loja-um");
    if (updateError) throw updateError;

    await seedCrawlStateSlugs(client, PLATFORM_ID, ["loja-um", "loja-tres"]);

    const { data, error } = await client
      .from("crawl_state")
      .select("slug, tier, last_checked_at, last_outcome")
      .eq("platform_id", PLATFORM_ID)
      .order("slug");
    expect(error).toBeNull();
    expect(data).toEqual([
      { slug: "loja-dois", tier: "tail", last_checked_at: null, last_outcome: null },
      { slug: "loja-tres", tier: "tail", last_checked_at: null, last_outcome: null },
      { slug: "loja-um", tier: "active", last_checked_at: "2026-07-13T00:00:00+00:00", last_outcome: "offer" },
    ]);
  });
});
