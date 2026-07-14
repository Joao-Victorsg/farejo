import type { RawOffer, ScrapeResult } from "@farejo/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localSupabaseClient } from "../testDb.js";
import { runPlatformScrape } from "./scrapeRun.js";

/**
 * T5/#17 — `loadBaseline` filtra por `(platform_id, scope)`, e `scope='bootstrap'` nunca
 * aciona as regras relativas (1/2) do sanity, mesmo com baseline "quente" (ADR-0004).
 */
const client = localSupabaseClient();

const PLATFORM_SEGMENTED = "test-t17-segmented";
const PLATFORM_BOOTSTRAP = "test-t17-bootstrap";
const ALL_PLATFORMS = [PLATFORM_SEGMENTED, PLATFORM_BOOTSTRAP];

function offersOfCount(n: number, label: string): RawOffer[] {
  return Array.from({ length: n }, (_, i) => ({
    storeName: `${label} T17 ${i}`,
    rewardText: "5% cashback",
    url: `https://example.test/${label}-${i}`,
  }));
}

function scrapeResultOf(offers: RawOffer[], overrides: Partial<ScrapeResult> = {}): ScrapeResult {
  return { offers, scope: { kind: "full" }, rawCount: offers.length, softBlocks: 0, ...overrides };
}

describe("runPlatformScrape — sanity segmentado por scope (T5/#17, Postgres local)", () => {
  beforeAll(async () => {
    const { error } = await client
      .from("platforms")
      .upsert(ALL_PLATFORMS.map((id) => ({ id, name: id, base_url: `https://${id}.test` })));
    if (error) throw error;
  });

  afterAll(async () => {
    const { data: aliases } = await client.from("store_aliases").select("store_id").in("platform_id", ALL_PLATFORMS);
    const storeIds = [...new Set((aliases ?? []).map((a) => a.store_id).filter((id) => id != null))];

    await client.from("offer_history").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("offers").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("scrape_runs").delete().in("platform_id", ALL_PLATFORMS);
    await client.from("store_aliases").delete().in("platform_id", ALL_PLATFORMS);
    if (storeIds.length > 0) await client.from("stores").delete().in("id", storeIds);
    await client.from("platforms").delete().in("id", ALL_PLATFORMS);
  });

  it("segmenta o baseline por scope: tail não é contaminado por active mais recente, e active detecta uma queda real que um baseline misturado mascararia", async () => {
    // 3 runs 'tail' ok, contagem estável e pequena (5), seguidos de 3 runs 'active' ok
    // maiores (50) — nessa ordem cronológica, "os últimos 5 runs ok da plataforma" (sem
    // filtrar por scope) trariam 3 active + 2 tail, um baseline misturado em ambos os casos.
    for (let i = 0; i < 3; i++) {
      const run = await runPlatformScrape(
        client,
        PLATFORM_SEGMENTED,
        scrapeResultOf(offersOfCount(5, `tail-seed-${i}`)),
        new Date(`2026-07-13T0${i}:00:00Z`),
        "tail",
      );
      expect(run.status).toBe("ok");
    }
    for (let i = 0; i < 3; i++) {
      const run = await runPlatformScrape(
        client,
        PLATFORM_SEGMENTED,
        scrapeResultOf(offersOfCount(50, `active-seed-${i}`)),
        new Date(`2026-07-13T0${i + 3}:00:00Z`),
        "active",
      );
      expect(run.status).toBe("ok");
    }

    // tail: 4/5 = 80% do próprio baseline tail (5) → ok isolado. Um baseline misturado com
    // as 3 corridas active(50) mais recentes daria média ~32 (floor 19.2), e 4 dispararia
    // suspicious — teria sido um falso positivo por contaminação.
    const tailRun = await runPlatformScrape(
      client,
      PLATFORM_SEGMENTED,
      scrapeResultOf(offersOfCount(4, "tail-check")),
      new Date("2026-07-13T07:00:00Z"),
      "tail",
    );
    expect(tailRun.status).toBe("ok");

    // active: 25/50 = 50% do próprio baseline active → queda real, deveria disparar. Um
    // baseline misturado com os 2 tail(5) mais antigos ainda no window de 5 diluiria a
    // média pra ~32 (floor 19.2) e 25 passaria como "ok" — um falso negativo mascarando a
    // queda de verdade. Segmentado por scope, o baseline é só os 3 active(50): 25 < 30 cai.
    const activeRun = await runPlatformScrape(
      client,
      PLATFORM_SEGMENTED,
      scrapeResultOf(offersOfCount(25, "active-check")),
      new Date("2026-07-13T08:00:00Z"),
      "active",
    );
    expect(activeRun.status).toBe("suspicious");
    expect(["rule1_offers_found", "rule2_active_offers"]).toContain(activeRun.tripped);
  }, 15_000);

  it("grava scrape_runs.scope a partir do escopo do run em andamento", async () => {
    await runPlatformScrape(
      client,
      PLATFORM_SEGMENTED,
      scrapeResultOf(offersOfCount(3, "scope-column-check")),
      new Date("2026-07-13T09:00:00Z"),
      "tail",
    );

    const { data, error } = await client
      .from("scrape_runs")
      .select("scope")
      .eq("platform_id", PLATFORM_SEGMENTED)
      .eq("started_at", "2026-07-13T09:00:00Z")
      .single();
    expect(error).toBeNull();
    expect(data!.scope).toBe("tail");
  });

  it("scope='bootstrap' nunca dispara rule1/rule2, mesmo com 3+ runs bootstrap acumulados, mas rule3 continua avaliada", async () => {
    for (let i = 0; i < 3; i++) {
      const run = await runPlatformScrape(
        client,
        PLATFORM_BOOTSTRAP,
        scrapeResultOf(offersOfCount(50, `bootstrap-seed-${i}`)),
        new Date(`2026-07-14T0${i}:00:00Z`),
        "bootstrap",
      );
      expect(run.status).toBe("ok");
    }

    // Queda de 50 → 2 (4%): dispararia rule1/rule2 para qualquer outro scope, mas
    // bootstrap nunca aciona as regras relativas, independente do baseline estar "quente".
    const droppedRun = await runPlatformScrape(
      client,
      PLATFORM_BOOTSTRAP,
      scrapeResultOf(offersOfCount(2, "bootstrap-dropped")),
      new Date("2026-07-14T04:00:00Z"),
      "bootstrap",
    );
    expect(droppedRun).toMatchObject({ status: "ok", tripped: null });

    // Regra 3 (parse errors) continua absoluta e avaliada normalmente para bootstrap.
    const badOffer: RawOffer = {
      storeName: "Bootstrap Parse Error T17",
      rewardText: "Ofertas disponíveis", // não casa com nenhum formato conhecido
      url: "https://example.test/bootstrap-parse-error",
    };
    const parseErrorRun = await runPlatformScrape(
      client,
      PLATFORM_BOOTSTRAP,
      scrapeResultOf([badOffer], { rawCount: 1 }),
      new Date("2026-07-14T05:00:00Z"),
      "bootstrap",
    );
    expect(parseErrorRun).toMatchObject({ status: "suspicious", tripped: "rule3_parse_errors" });
  });
});
