import { describe, expect, it } from "vitest";
import { localSupabaseClient } from "./testDb.js";

describe("migration + seed (Postgres local)", () => {
  it("seeds the 5 platforms", async () => {
    const client = localSupabaseClient();

    const { data, error } = await client.from("platforms").select("id").order("id");

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
