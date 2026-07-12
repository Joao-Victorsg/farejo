// Chaves do stack local (`supabase start`): JWT demo público do Supabase CLI, fixo em todo
// projeto local, nunca usado em produção. `.env` (opcional) aponta p/ o projeto hospedado.
export const LOCAL_URL = "http://127.0.0.1:55321";
export const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/** Alvo default = stack local; `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (via `.env`) apontam pro projeto hospedado. */
export function resolveSupabaseCredentials(): { url: string; key: string } {
  return {
    url: process.env.SUPABASE_URL ?? LOCAL_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY ?? LOCAL_SERVICE_ROLE_KEY,
  };
}
