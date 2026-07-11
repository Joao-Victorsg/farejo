import "dotenv/config";
import { createClient } from "@farejo/shared";
import { describe, expect, it } from "vitest";

// Chaves do stack local (`supabase start`): JWT demo público do Supabase CLI, fixo em todo
// projeto local, nunca usado em produção. `.env` (opcional) aponta p/ o projeto hospedado.
const LOCAL_URL = "http://127.0.0.1:55321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

describe("migration + seed (Postgres local)", () => {
  it("seeds the 5 platforms", async () => {
    const client = createClient(
      process.env.SUPABASE_URL ?? LOCAL_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? LOCAL_SERVICE_ROLE_KEY,
    );

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
