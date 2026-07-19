import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { Button } from "@/components/ui/button";
import { getPlatformStats, type PlatformStat } from "@/lib/catalog";
import { editorial } from "@/lib/content";
import { isAnomalousPlatformCoverage } from "@/lib/offer-ranking";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Plataformas" };

const PLATFORM_ICONS: Record<string, string> = {
  meliuz: "/portals/meliuz.svg",
  cuponomia: "/portals/cupons.svg",
  mycashback: "/portals/mycashback.svg",
  zoom: "/portals/zoom.svg",
  inter: "/portals/inter.svg",
};

function formatPercent(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function PlatformsError() {
  return (
    <PageFrame>
      <main id="conteudo" tabIndex={-1}>
        <section className="mx-auto max-w-[1160px] px-5 py-24 sm:px-8">
          <p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">PLATAFORMAS</p>
          <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em]">Não conseguimos carregar as estatísticas agora.</h1>
          <p className="mt-5 max-w-xl leading-7 text-[#5b5f56]">Tente novamente em alguns instantes. Nenhuma plataforma foi tratada como sem cobertura.</p>
          <Button asChild className="mt-8"><Link href="/plataformas">Tentar novamente</Link></Button>
        </section>
      </main>
    </PageFrame>
  );
}

function PlatformCard({ stat }: { stat: PlatformStat }) {
  const isInter = stat.platformId === "inter";

  return (
    <li className="rounded-2xl border border-[#ece9e2] bg-white p-6">
      <div className="flex items-center gap-3.5">
        {/* fallback nunca deveria disparar: platform_stats só retorna as 5 plataformas canônicas do mapa acima */}
        <Image alt="" aria-hidden="true" className="rounded-xl border border-[#ece9e2] p-1.5" height={46} src={PLATFORM_ICONS[stat.platformId] ?? "/portals/mycashback.svg"} width={46} />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold tracking-[-0.03em]">{stat.platformName}</h2>
          <p className="text-[12.5px] text-[#70736a]">{stat.storeCount === 0 ? "Ainda sem lojas elegíveis" : `em ${stat.storeCount.toLocaleString("pt-BR")} ${stat.storeCount === 1 ? "loja" : "lojas"}`}</p>
        </div>
      </div>
      <div className="mt-5 flex gap-2.5">
        <div className="flex-1 rounded-xl border border-[#f1efe8] bg-[#faf9f5] p-3.5">
          <p className="font-numbers text-xl font-semibold tracking-[-0.02em]">{stat.percentAverage === null ? "—" : formatPercent(stat.percentAverage)}</p>
          <p className="mt-1 text-[11px] text-[#70736a]">média por loja</p>
        </div>
        <div className="flex-1 rounded-xl border border-[#cfe7d9] bg-[#f2f9f5] p-3.5">
          <p className="font-numbers text-xl font-semibold tracking-[-0.02em] text-[#1c7a4d]">{stat.percentPeak === null ? "—" : `${stat.percentPeakIsUpto ? "Até " : ""}${formatPercent(stat.percentPeak)}`}</p>
          <p className="mt-1 text-[11px] text-[#686c60]">pico anunciado</p>
        </div>
      </div>
      {stat.percentAverage === null ? <p className="mt-3 text-xs text-[#805e26]">Sem taxa percentual disponível no momento.</p> : null}
      {isInter ? (
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[#f6ece2] px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.03em] text-[#a34e22]">
          <span aria-hidden="true" className="size-[5px] rounded-full bg-[#c05f2b]" />
          PARA CORRENTISTAS
        </div>
      ) : null}
    </li>
  );
}

export default async function PlatformsPage() {
  let stats: PlatformStat[];
  try {
    stats = await getPlatformStats();
  } catch {
    return <PlatformsError />;
  }

  const isAnomalousEmpty = isAnomalousPlatformCoverage(stats);

  return (
    <PageFrame>
      <main id="conteudo" tabIndex={-1}>
        <section className="mx-auto w-full max-w-[1160px] px-5 py-16 sm:px-8 sm:py-24">
          <p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">{editorial.platforms.eyebrow}</p>
          <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">{editorial.platforms.title}</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[#5b5f56]">{editorial.platforms.description}</p>
          {isAnomalousEmpty ? (
            <div className="mt-10 rounded-2xl border border-[#e0ddd4] bg-[#faf9f5] p-6">
              <h2 className="text-xl font-bold">Nenhuma plataforma tem cobertura no momento.</h2>
              <p className="mt-2 text-[#5b5f56]">Isso pode indicar uma anomalia nos dados. Tente novamente em alguns instantes.</p>
            </div>
          ) : (
            <ul aria-label="Estatísticas por plataforma" className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {stats.map((stat) => <PlatformCard key={stat.platformId} stat={stat} />)}
            </ul>
          )}
        </section>
      </main>
    </PageFrame>
  );
}
