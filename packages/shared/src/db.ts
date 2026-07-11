import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

/**
 * Credenciais entram por parâmetro (ADR-0002) — shared nunca lê process.env.
 * Cada app injeta a sua: o scraper com service_role; o web (Fase 3) com anon/RLS.
 */
export function createClient(url: string, key: string): SupabaseClient<Database> {
  return createSupabaseClient<Database>(url, key);
}
