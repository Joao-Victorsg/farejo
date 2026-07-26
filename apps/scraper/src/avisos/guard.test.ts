import { describe, expect, it } from "vitest";
import { assertNoScrapeInFlight, type GuardPool } from "./guard.js";

/** `count(*)` é `bigint`: o driver `pg` devolve como string, nunca number — o fake espelha isso. */
function fakePool(count: string): GuardPool {
  return {
    async query<T = unknown>() {
      return { rows: [{ count }] as T[] };
    },
  };
}

function emptyPool(): GuardPool {
  return {
    async query<T = unknown>() {
      return { rows: [] as T[] };
    },
  };
}

describe("assertNoScrapeInFlight", () => {
  it("resolve quando a contagem é zero", async () => {
    await expect(assertNoScrapeInFlight(fakePool("0"))).resolves.toBeUndefined();
  });

  it("resolve quando a query não devolve linha nenhuma (trata como zero)", async () => {
    await expect(assertNoScrapeInFlight(emptyPool())).resolves.toBeUndefined();
  });

  it("recusa quando a contagem é 1", async () => {
    await expect(assertNoScrapeInFlight(fakePool("1"))).rejects.toThrow(/1 scrape_runs sem finished_at/);
  });

  it("recusa quando a contagem é maior que 1, citando o número", async () => {
    await expect(assertNoScrapeInFlight(fakePool("3"))).rejects.toThrow(/3 scrape_runs sem finished_at/);
  });

  it("a mensagem de recusa cita o motivo (watermark inseguro) para quem só ver o log", async () => {
    await expect(assertNoScrapeInFlight(fakePool("2"))).rejects.toThrow(/watermark inseguro/);
  });
});
