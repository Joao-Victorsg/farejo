import { describe, expect, it } from "vitest";
import { localSupabaseClient } from "./testDb.js";

describe("migration + seed (Postgres local)", () => {
  it("seeds the 5 platforms", async () => {
    const client = localSupabaseClient();

    // Escopado às 5 plataformas reais (não um select("*") do platforms inteiro): outros
    // arquivos de teste rodam em paralelo (vitest, arquivos concorrentes) e semeiam suas
    // próprias plataformas test-* na mesma tabela — um select irrestrito é uma corrida.
    const { data, error } = await client
      .from("platforms")
      .select("id")
      .in("id", ["cuponomia", "inter", "meliuz", "mycashback", "zoom"])
      .order("id");

    expect(error).toBeNull();
    expect(data?.map((p) => p.id).sort()).toEqual([
      "cuponomia",
      "inter",
      "meliuz",
      "mycashback",
      "zoom",
    ]);
  });
});
