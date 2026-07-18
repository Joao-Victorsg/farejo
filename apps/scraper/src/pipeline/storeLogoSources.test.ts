import { l2Key, type RawOffer, type ScrapeResult } from "@farejo/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localSupabaseClient } from "../testDb.js";
import { runPipeline } from "./run.js";
import { runPlatformScrape } from "./scrapeRun.js";

/**
 * F3/T11 (#57, ADR-0038) — `store_logo_sources` guarda no máximo uma fonte de logo
 * corrente por (store_id, platform_id), escrita na MESMA transação de `pipeline_write_offers`
 * quando `RawOffer.logoUrl` está presente. Cobre: upsert em run aceito, substituição por
 * mudança de URL, preservação quando a URL some numa leitura seguinte, idempotência, e que
 * um run rejeitado pelo sanity check nunca chega a tocar a tabela — além dos privilégios
 * negativos que mantêm a tabela fora do Data API e de `farejo_web`.
 */
const client = localSupabaseClient();

const PLATFORM_ID = "test-t57";
const PLATFORM_REJECTED = "test-t57-rejected";
const ALL_PLATFORMS = [PLATFORM_ID, PLATFORM_REJECTED];

function offer(storeName: string, rewardText: string, extra: Partial<RawOffer> = {}): RawOffer {
  return { storeName, rewardText, url: `https://example.test/${storeName}`, ...extra };
}

function scrapeResult(offers: RawOffer[], overrides: Partial<ScrapeResult> = {}): ScrapeResult {
  return { offers, scope: { kind: "full" }, rawCount: offers.length, softBlocks: 0, ...overrides };
}

async function storeIdFor(storeName: string): Promise<number> {
  const { data, error } = await client.from("stores").select("id").eq("slug", l2Key(storeName)).single();
  if (error) throw error;
  return data.id;
}

async function logoSourceFor(storeId: number, platformId: string) {
  const { data, error } = await client
    .from("store_logo_sources")
    .select("url, last_seen_at")
    .eq("store_id", storeId)
    .eq("platform_id", platformId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

describe("store_logo_sources (Postgres local, F3/T11/#57)", () => {
  beforeAll(async () => {
    const { error } = await client
      .from("platforms")
      .upsert(ALL_PLATFORMS.map((id) => ({ id, name: id, base_url: `https://${id}.test` })));
    if (error) throw error;
  });

  afterAll(async () => {
    const { data: aliases } = await client.from("store_aliases").select("store_id").in("platform_id", ALL_PLATFORMS);
    const storeIds = [...new Set((aliases ?? []).map((a) => a.store_id).filter((id) => id != null))];

    await client.from("store_logo_sources").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("scrape_runs").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("offer_history").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("offers").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("store_aliases").delete().in("platform_id", ALL_PLATFORMS);
    if (storeIds.length > 0) await client.from("stores").delete().in("id", storeIds);
    await client.from("platforms").delete().in("id", ALL_PLATFORMS);
  });

  it("upserts the observed source on first sight", async () => {
    const storeName = "Logo First Seen T57";
    await runPipeline(
      client,
      PLATFORM_ID,
      scrapeResult([offer(storeName, "5% Cashback", { logoUrl: "https://cdn.test/first.png" })]),
      new Date("2026-07-10T03:00:00Z"),
    );

    const storeId = await storeIdFor(storeName);
    const source = await logoSourceFor(storeId, PLATFORM_ID);
    expect(source?.url).toBe("https://cdn.test/first.png");
  });

  it("replaces the current source when the platform's URL changes, without keeping history", async () => {
    const storeName = "Logo URL Change T57";
    const run1 = new Date("2026-07-10T03:00:00Z");
    const run2 = new Date("2026-07-10T15:00:00Z");

    await runPipeline(
      client,
      PLATFORM_ID,
      scrapeResult([offer(storeName, "5% Cashback", { logoUrl: "https://cdn.test/v1.png" })]),
      run1,
    );
    const storeId = await storeIdFor(storeName);

    await runPipeline(
      client,
      PLATFORM_ID,
      scrapeResult([offer(storeName, "5% Cashback", { logoUrl: "https://cdn.test/v2.png" })]),
      run2,
    );

    const source = await logoSourceFor(storeId, PLATFORM_ID);
    expect(source?.url).toBe("https://cdn.test/v2.png");
    expect(new Date(source!.last_seen_at).getTime()).toBe(run2.getTime());

    const { data: allRows, error } = await client
      .from("store_logo_sources")
      .select("url")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID);
    if (error) throw error;
    expect(allRows).toHaveLength(1); // no máximo uma linha por (store_id, platform_id)
  });

  it("preserves a valid source when a later run reports no logoUrl at all", async () => {
    const storeName = "Logo Momentarily Absent T57";
    const run1 = new Date("2026-07-10T03:00:00Z");
    const run2 = new Date("2026-07-10T15:00:00Z");

    await runPipeline(
      client,
      PLATFORM_ID,
      scrapeResult([offer(storeName, "5% Cashback", { logoUrl: "https://cdn.test/stable.png" })]),
      run1,
    );
    const storeId = await storeIdFor(storeName);

    // Run seguinte não reporta logoUrl (adapter não achou desta vez) — não é json null,
    // é a CHAVE ausente do RawOffer; a fonte válida anterior não pode ser apagada.
    await runPipeline(client, PLATFORM_ID, scrapeResult([offer(storeName, "5% Cashback")]), run2);

    const source = await logoSourceFor(storeId, PLATFORM_ID);
    expect(source?.url).toBe("https://cdn.test/stable.png");
  });

  it("is idempotent: re-running with the same URL keeps a single row and bumps last_seen_at", async () => {
    const storeName = "Logo Idempotent T57";
    const run1 = new Date("2026-07-10T03:00:00Z");
    const run2 = new Date("2026-07-10T15:00:00Z");

    await runPipeline(
      client,
      PLATFORM_ID,
      scrapeResult([offer(storeName, "5% Cashback", { logoUrl: "https://cdn.test/same.png" })]),
      run1,
    );
    const storeId = await storeIdFor(storeName);

    await runPipeline(
      client,
      PLATFORM_ID,
      scrapeResult([offer(storeName, "5% Cashback", { logoUrl: "https://cdn.test/same.png" })]),
      run2,
    );

    const { data: allRows, error } = await client
      .from("store_logo_sources")
      .select("url, last_seen_at")
      .eq("store_id", storeId)
      .eq("platform_id", PLATFORM_ID);
    if (error) throw error;
    expect(allRows).toHaveLength(1);
    expect(allRows![0]).toMatchObject({ url: "https://cdn.test/same.png" });
    expect(new Date(allRows![0]!.last_seen_at).getTime()).toBe(run2.getTime());
  });

  it("never touches the table for a run the sanity gate rejects as suspicious", async () => {
    const storeName = "Logo Rejected Run T57";
    const run1 = new Date("2026-07-11T03:00:00Z");
    const run2 = new Date("2026-07-11T15:00:00Z");

    const accepted = await runPlatformScrape(
      client,
      PLATFORM_REJECTED,
      scrapeResult([offer(storeName, "5% Cashback", { logoUrl: "https://cdn.test/accepted.png" })], {
        declaredTotal: 1,
      }),
      run1,
    );
    expect(accepted.status).toBe("ok");
    const storeId = await storeIdFor(storeName);

    // declaredTotal (5) != rawCount (1) dispara rule4 — a escrita inteira, oferta e
    // fonte de logo, nunca acontece (ADR-0004/ADR-0038).
    const rejected = await runPlatformScrape(
      client,
      PLATFORM_REJECTED,
      scrapeResult([offer(storeName, "5% Cashback", { logoUrl: "https://cdn.test/rejected-attempt.png" })], {
        declaredTotal: 5,
      }),
      run2,
    );
    expect(rejected.status).toBe("suspicious");

    const source = await logoSourceFor(storeId, PLATFORM_REJECTED);
    expect(source?.url).toBe("https://cdn.test/accepted.png");
  });
});
