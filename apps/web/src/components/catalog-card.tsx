"use client";

import Link from "next/link";
import type { CatalogStore } from "@/lib/catalog";
import { useInterPreference } from "@/lib/inter-preference";
import { effectiveSignals, formatPreviousValue, formatReward, isInterCorrentistaOffer, rankOffers } from "@/lib/offer-ranking";

const VISIBLE_OFFERS = 3;

export function CatalogCard({ store }: { store: CatalogStore }) {
  const { isCorrentista } = useInterPreference();
  const offers = rankOffers(store.offers, isCorrentista);
  const visibleOffers = offers.slice(0, VISIBLE_OFFERS);
  const remaining = offers.length - visibleOffers.length;
  const initial = store.name.trim().charAt(0).toLocaleUpperCase("pt-BR") || "L";

  return (
    <article className="rounded-2xl border border-[#ece9e2] bg-white shadow-[0_10px_30px_-18px_rgba(0,0,0,.25)]">
      <Link aria-label={`Ver ofertas de ${store.name}`} className="block rounded-2xl p-5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d]" href={`/loja/${store.slug}`}>
        <div className="flex items-start gap-3">
          {store.logoUrl ? (
            <img alt="" aria-hidden="true" className="size-12 rounded-xl border border-[#ece9e2] object-contain p-1" height={48} src={store.logoUrl} width={48} />
          ) : (
            <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#e7f4ec] font-mono text-lg font-semibold text-[#1c7a4d]">{initial}</span>
          )}
          <div className="min-w-0"><h3 className="truncate text-lg font-bold tracking-[-0.03em]">{store.name}</h3><p className="mt-1 text-sm text-[#5b5f56]">{store.platformCount} {store.platformCount === 1 ? "plataforma" : "plataformas"}</p></div>
        </div>
        <ul className="mt-5 space-y-2" aria-label={`Ofertas de ${store.name}`}>
          {visibleOffers.map((offer, index) => {
            const signals = effectiveSignals(offer, isCorrentista);
            const previousText = formatPreviousValue(offer, isCorrentista);
            return (
              <li className="flex items-center justify-between gap-3 rounded-lg bg-[#faf9f5] px-3 py-2 text-sm" key={offer.platformId}>
                <span className="min-w-0 truncate font-medium">{offer.platformName}{isInterCorrentistaOffer(offer) ? <span className="ml-2 text-xs font-normal text-[#5b5f56]">{isCorrentista ? "(correntista)" : "(não correntista)"}</span> : null}</span>
                <span className="flex shrink-0 items-center gap-2 font-semibold text-[#1c7a4d]">
                  {index === 0 ? <span className="rounded-full bg-[#e7f4ec] px-2 py-0.5 font-mono text-[10px] font-medium text-[#1c7a4d]">MELHOR</span> : null}
                  {signals.isBoost ? <span className="rounded-full bg-[#fdece0] px-2 py-0.5 font-mono text-[10px] font-medium text-[#b5541c]">BOOST</span> : null}
                  {formatReward(offer, isCorrentista)}
                  {previousText ? <span className="text-xs font-normal text-[#5b5f56]">(era {previousText})</span> : null}
                  {offer.freshness === "delayed" ? <span className="rounded-full bg-[#f0e7d3] px-2 py-0.5 font-mono text-[10px] font-medium text-[#8a6a33]">Atualização atrasada</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
        {remaining > 0 ? <p className="mt-3 text-xs font-medium text-[#5b5f56]">+{remaining} {remaining === 1 ? "outra plataforma" : "outras plataformas"}</p> : null}
      </Link>
    </article>
  );
}
