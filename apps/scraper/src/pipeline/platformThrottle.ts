import type { ThrottleMultiplier } from "@farejo/shared";
import type { SupabaseClient } from "../supabaseClient.js";

function isThrottleMultiplier(value: number): value is ThrottleMultiplier {
  return value === 1 || value === 2 || value === 4;
}

/** Lê `platforms.throttle_multiplier` (ADR-0005 decisão 2 — CHECK 1|2|4 já garantido pelo schema). */
export async function loadThrottleMultiplier(supabase: SupabaseClient, platformId: string): Promise<ThrottleMultiplier> {
  const { data, error } = await supabase
    .from("platforms")
    .select("throttle_multiplier")
    .eq("id", platformId)
    .single();
  if (error) throw error;

  const value = data.throttle_multiplier;
  if (!isThrottleMultiplier(value)) {
    throw new Error(`platforms.throttle_multiplier inválido para "${platformId}": ${value} (esperado 1, 2 ou 4)`);
  }
  return value;
}

/** Persiste o nível seguinte — avaliado 1x por run, inter-run, nunca dentro do run (ADR-0005 decisão 3). */
export async function updateThrottleMultiplier(
  supabase: SupabaseClient,
  platformId: string,
  multiplier: ThrottleMultiplier,
): Promise<void> {
  const { error } = await supabase.from("platforms").update({ throttle_multiplier: multiplier }).eq("id", platformId);
  if (error) throw error;
}
