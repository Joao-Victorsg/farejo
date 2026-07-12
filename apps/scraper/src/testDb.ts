import "dotenv/config";
import { createClient } from "@farejo/shared";
import { resolveSupabaseCredentials } from "./localDb.js";

/** Cliente service_role usado pelos testes de integração (Seam B/C) contra Postgres local. */
export function localSupabaseClient() {
  const { url, key } = resolveSupabaseCredentials();
  return createClient(url, key);
}
