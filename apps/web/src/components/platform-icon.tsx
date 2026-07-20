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

export function PlatformIcon({ platformId }: { platformId: string }) {
  return <Image alt="" aria-hidden="true" className="size-6 shrink-0 rounded-[7px] border border-[#ece9e2] bg-white object-contain p-[3px]" height={24} src={PLATFORM_ICONS[platformId] ?? "/portals/mycashback.png"} width={24} />;
}
