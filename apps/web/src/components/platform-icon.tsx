import Image from "next/image";

/**
 * Ícone nominativo da plataforma numa linha de oferta. Reusa os cinco assets fixos de
 * `public/portals` (mesma fonte da página `/plataformas`): como são imagens, a marca colorida
 * não dispara a regra de contraste do axe que texto branco sobre a cor da marca dispararia.
 */
const PLATFORM_ICONS: Record<string, string> = {
  meliuz: "/portals/meliuz.png",
  cuponomia: "/portals/cuponomia.png",
  mycashback: "/portals/mycashback.png",
  zoom: "/portals/zoom.png",
  inter: "/portals/inter.svg",
};

export function PlatformIcon({ platformId, size = 24 }: { platformId: string; size?: number }) {
  return <Image alt="" aria-hidden="true" className={`shrink-0 object-contain ${size >= 40 ? "rounded-xl" : "rounded-[6px]"}`} height={size} src={PLATFORM_ICONS[platformId] ?? "/portals/mycashback.png"} style={{ height: size, width: size }} width={size} />;
}
