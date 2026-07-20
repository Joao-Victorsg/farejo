"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { CatalogStore } from "@/lib/catalog";
import { useInterPreference } from "@/lib/inter-preference";
import { PlatformIcon } from "@/components/platform-icon";
import { effectiveSignals, formatPreviousValue, formatReward, isInterCorrentistaOffer, rankOffers } from "@/lib/offer-ranking";

const VISIBLE_OFFERS = 3;

export function CatalogCard({ store }: { store: CatalogStore }) {
  const { isCorrentista } = useInterPreference();
  const offers = rankOffers(store.offers, isCorrentista);
  const visibleOffers = offers.slice(0, VISIBLE_OFFERS);
  const remaining = offers.length - visibleOffers.length;
  const initial = store.name.trim().charAt(0).toLocaleUpperCase("pt-BR") || "L";
  const bestReward = offers.length > 0 ? formatReward(offers[0], isCorrentista) : null;

  return (
    <article className="rounded-2xl border border-[#ece9e2] bg-white shadow-[0_10px_30px_-18px_rgba(0,0,0,.25)] transition-shadow hover:shadow-[0_16px_40px_-20px_rgba(0,0,0,.3)]">
      <Link aria-label={`Ver ofertas de ${store.name}`} className="block rounded-2xl p-5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d]" href={`/loja/${store.slug}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {store.logoUrl ? (
              <img alt="" aria-hidden="true" className="size-12 rounded-xl border border-[#ece9e2] object-contain p-1" height={48} src={store.logoUrl} width={48} />
            ) : (
              <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#e7f4ec] font-mono text-lg font-semibold text-[#1c7a4d]">{initial}</span>
            )}
            <div className="min-w-0"><h3 className="truncate text-lg font-bold tracking-[-0.03em]">{store.name}</h3><p className="mt-1 text-sm text-[#5b5f56]">{store.platformCount} {store.platformCount === 1 ? "plataforma" : "plataformas"}</p></div>
          </div>
          {bestReward ? <div className="shrink-0 text-right"><p className="font-numbers text-2xl font-bold leading-none text-[#1c7a4d]">{bestReward}</p><p className="mt-1 font-mono text-[10px] tracking-[0.12em] text-[#5b5f56]">MELHOR</p></div> : null}
        </div>
        <ul className="mt-5 space-y-2" aria-label={`Ofertas de ${store.name}`}>
          {visibleOffers.map((offer, index) => {
            const signals = effectiveSignals(offer, isCorrentista);
            const previousText = formatPreviousValue(offer, isCorrentista);
            return (
              <li className="flex items-center justify-between gap-3 rounded-lg bg-[#faf9f5] px-3 py-2 text-sm" key={offer.platformId}>
                <span className="flex min-w-0 items-center gap-2">
                  <PlatformIcon platformId={offer.platformId} />
                  <span className="min-w-0 truncate font-medium">{offer.platformName}{isInterCorrentistaOffer(offer) ? <span className="ml-1 text-xs font-normal text-[#5b5f56]">{isCorrentista ? "(correntista)" : "(não correntista)"}</span> : null}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 font-numbers font-semibold text-[#1c7a4d]">
                  {index === 0 ? <span className="rounded-full bg-[#e7f4ec] px-2 py-0.5 font-mono text-[10px] font-medium text-[#1c7a4d]">MELHOR</span> : null}
                  {signals.isBoost ? <span className="rounded-full bg-[#fdece0] px-2 py-0.5 font-mono text-[10px] font-medium text-[#aa4a14]">BOOST</span> : null}
                  {offer.freshness === "delayed" ? <span title="Atualização atrasada" className="rounded-full bg-[#f0e7d3] px-2 py-0.5 font-mono text-[10px] font-medium text-[#805e26]">ATRASADO</span> : null}
                  {formatReward(offer, isCorrentista)}
                  {previousText ? <span className="font-sans text-xs font-normal text-[#5b5f56]">(era {previousText})</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex items-center justify-between gap-3">
          {remaining > 0 ? <p className="text-xs font-medium text-[#5b5f56]">+{remaining} {remaining === 1 ? "outra plataforma" : "outras plataformas"}</p> : <span />}
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1c7a4d]">Ver todas<ArrowRight aria-hidden="true" size={13} /></span>
        </div>
      </Link>
    </article>
  );
}
