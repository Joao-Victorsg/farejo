import type { Metadata } from "next";
import Image from "next/image";
import { PageFrame } from "@/components/page-frame";

export const metadata: Metadata = { title: "Plataformas" };

const platforms = [
  { name: "Méliuz", icon: "/portals/meliuz.svg" },
  { name: "Cuponomia", icon: "/portals/cupons.svg" },
  { name: "MyCashback", icon: "/portals/mycashback.svg" },
  { name: "Zoom", icon: "/portals/zoom.svg" },
  { name: "Inter", icon: "/portals/inter.svg" },
] as const;

export default function PlatformsPage() {
  return <PageFrame><main id="conteudo" className="mx-auto w-full max-w-[1160px] px-5 py-16 sm:px-8 sm:py-24"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">PLATAFORMAS</p><h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">As plataformas que comparamos</h1><p className="mt-5 max-w-2xl text-lg leading-8 text-[#5b5f56]">O farejô acompanha Méliuz, Cuponomia, MyCashback, Zoom e Inter. As estatísticas e ofertas verificadas entram junto do catálogo público.</p><ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{platforms.map((platform) => <li className="flex min-h-36 items-center gap-5 rounded-2xl border border-[#ece9e2] bg-white p-7" key={platform.name}><Image alt="" aria-hidden="true" height={48} src={platform.icon} width={48} /><span className="text-xl font-bold tracking-[-0.03em]">{platform.name}</span></li>)}</ul></main></PageFrame>;
}
