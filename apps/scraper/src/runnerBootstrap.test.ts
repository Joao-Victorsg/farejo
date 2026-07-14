import type { PlatformAdapter, ScrapeInstruction, ScrapeResult, SlugOutcome } from "@farejo/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runBootstrapPlatform } from "./runner.js";
import { localSupabaseClient } from "./testDb.js";

const client = localSupabaseClient();
const PLATFORM_ID = "test-t24-bootstrap";

interface RecordingAdapter extends PlatformAdapter {
  receivedInstructions: ScrapeInstruction[];
}

function bootstrapAdapter(): RecordingAdapter {
  const receivedInstructions: ScrapeInstruction[] = [];
  return {
    platformId: PLATFORM_ID,
    receivedInstructions,
    async scrape(instruction: ScrapeInstruction): Promise<ScrapeResult> {
      receivedInstructions.push(instruction);
      if (instruction.target.kind !== "slugs") throw new Error("bootstrap requer target.kind='slugs'");
      const outcomes: SlugOutcome[] = instruction.target.slugs.map((slug) => ({ slug, outcome: "no_cashback" }));
      return {
        offers: [],
        scope: { kind: "partial", slugs: new Set(instruction.target.slugs) },
        rawCount: outcomes.length,
        softBlocks: 0,
        outcomes,
      };
    },
  };
}

async function seedSlug(slug: string, lastCheckedAt: string | null): Promise<void> {
  const { error } = await client
    .from("crawl_state")
    .upsert({ platform_id: PLATFORM_ID, slug, tier: "tail", last_checked_at: lastCheckedAt });
  if (error) throw error;
}

describe("runBootstrapPlatform (T12/#24, Postgres local)", () => {
  beforeAll(async () => {
    const { error } = await client
      .from("platforms")
      .upsert({ id: PLATFORM_ID, name: "Test T24 bootstrap", base_url: "https://t24-bootstrap.test" });
    if (error) throw error;

    await seedSlug("a-pendente", null);
    await seedSlug("b-pendente", null);
    await seedSlug("c-ja-visitada", "2026-07-13T00:00:00Z");
  });

  afterAll(async () => {
    await client.from("crawl_state").delete().eq("platform_id", PLATFORM_ID);
    await client.from("scrape_runs").delete().eq("platform_id", PLATFORM_ID);
    await client.from("platforms").delete().eq("id", PLATFORM_ID);
  });

  it("monta lotes somente com last_checked_at IS NULL e retoma sem reprocessar desfechos reais", async () => {
    const adapter = bootstrapAdapter();

    const first = await runBootstrapPlatform(client, adapter, 1);
    const second = await runBootstrapPlatform(client, adapter, 1);

    expect(first).toMatchObject({ platformId: PLATFORM_ID, status: "ok" });
    expect(second).toMatchObject({ platformId: PLATFORM_ID, status: "ok" });
    expect(adapter.receivedInstructions).toEqual([
      { throttleMultiplier: 1, target: { kind: "slugs", slugs: ["a-pendente"] } },
      { throttleMultiplier: 1, target: { kind: "slugs", slugs: ["b-pendente"] } },
    ]);

    const { data: state, error: stateError } = await client
      .from("crawl_state")
      .select("slug, last_checked_at")
      .eq("platform_id", PLATFORM_ID)
      .order("slug");
    expect(stateError).toBeNull();
    expect(state?.every((row) => row.last_checked_at !== null)).toBe(true);

    const { data: runs, error: runsError } = await client
      .from("scrape_runs")
      .select("scope")
      .eq("platform_id", PLATFORM_ID);
    expect(runsError).toBeNull();
    expect(runs).toEqual([{ scope: "bootstrap" }, { scope: "bootstrap" }]);
  });
});
