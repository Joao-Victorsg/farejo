/**
 * Ícone nominativo das plataformas comparadas. Cores e códigos de duas letras vêm do handoff
 * (`docs/design_handoff_farejo`). Plataforma desconhecida cai num neutro em vez de sumir.
 */
const PLATFORM_BADGE: Record<string, { color: string; code: string }> = {
  meliuz: { color: "#ff2d6b", code: "mz" },
  cuponomia: { color: "#0a66ff", code: "cp" },
  mycashback: { color: "#7c3aed", code: "my" },
  zoom: { color: "#4163f1", code: "zm" },
  inter: { color: "#ff6a00", code: "in" },
};

export function PlatformIcon({ platformId, platformName }: { platformId: string; platformName: string }) {
  const badge = PLATFORM_BADGE[platformId] ?? { color: "#5b5f56", code: platformName.trim().slice(0, 2).toLowerCase() || "•" };
  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 items-center justify-center rounded-[7px] font-mono text-[10px] font-medium lowercase text-white"
      style={{ backgroundColor: badge.color }}
    >
      {badge.code}
    </span>
  );
}
