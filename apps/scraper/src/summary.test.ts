import { describe, expect, it, vi } from "vitest";
import { formatSummaryMessage, sendTelegramMessage, type SummaryRun } from "./summary.js";

const jobs = [
  { platformId: "inter", scope: "full", label: "Inter" },
  { platformId: "cuponomia", scope: "active", label: "Cuponomia (active)" },
  { platformId: "meliuz", scope: "tail", label: "Méliuz (tail)" },
] as const;

describe("formatSummaryMessage", () => {
  it("emite uma linha por job com contagens para runs ok e o motivo para suspicious/failed", () => {
    const runs: SummaryRun[] = [
      {
        platformId: "inter",
        scope: "full",
        status: "ok",
        offersFound: 374,
        activeOffers: 363,
        parseErrors: 0,
        notes: null,
      },
      {
        platformId: "cuponomia",
        scope: "active",
        status: "suspicious",
        offersFound: 500,
        activeOffers: 200,
        parseErrors: 0,
        notes: JSON.stringify({ tripped: "rule2_active_offers" }),
      },
      {
        platformId: "meliuz",
        scope: "tail",
        status: "failed",
        offersFound: null,
        activeOffers: null,
        parseErrors: null,
        notes: JSON.stringify({ error: "request timed out" }),
      },
    ];

    expect(formatSummaryMessage(jobs, runs)).toBe([
      "✅ Inter — 374 encontradas, 363 ativas, 0 erros de parse",
      "⚠️ Cuponomia (active) — suspicious: rule2_active_offers",
      "❌ Méliuz (tail) — failed: request timed out",
    ].join("\n"));
  });

  it("marca jobs sem scrape_run no workflow como não executados", () => {
    expect(formatSummaryMessage(jobs, [])).toBe([
      "⏭️ Inter — não executado",
      "⏭️ Cuponomia (active) — não executado",
      "⏭️ Méliuz (tail) — não executado",
    ].join("\n"));
  });

  it("reporta falha do job mesmo quando ela aconteceu antes de gravar o scrape_run", () => {
    expect(formatSummaryMessage(jobs, [], { inter: { result: "failure" } })).toContain(
      "❌ Inter — failed: sem scrape_run",
    );
  });
});

describe("sendTelegramMessage", () => {
  it("captura uma falha do Telegram e informa o chamador sem lançar", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Telegram indisponível"));

    await expect(sendTelegramMessage({ token: "token", chatId: "chat", text: "resumo", fetch })).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
