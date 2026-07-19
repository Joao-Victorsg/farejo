"use client";

import { ExternalLink } from "lucide-react";
import { FreshnessSummary } from "@/components/freshness-summary";
import { InterToggle } from "@/components/inter-toggle";
import type { StoreDetail } from "@/lib/catalog";
import { useInterPreference } from "@/lib/inter-preference";
import { effectiveSignals, formatPreviousValue, formatReward, isInterCorrentistaOffer, rankOffers } from "@/lib/offer-ranking";

export function StoreRanking({ store }: { store: StoreDetail }) {
  const { isCorrentista } = useInterPreference();
  const offers = rankOffers(store.offers, isCorrentista);
  const oldestSeenAt = offers.reduce<string | null>((oldest, offer) => !oldest || offer.lastSeenAt < oldest ? offer.lastSeenAt : oldest, null);

  return (
    <section className="mt-8" aria-labelledby="ranking-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">OFERTAS ELEGÍVEIS</p><h2 className="mt-2 text-3xl font-bold tracking-[-0.04em]" id="ranking-heading">Ranking de cashback</h2></div>
        <div className="flex flex-wrap items-center gap-4">
          {oldestSeenAt ? <FreshnessSummary lastSeenAt={oldestSeenAt} /> : null}
          {offers.some((offer) => isInterCorrentistaOffer(offer)) ? <InterToggle compact /> : null}
        </div>
      </div>
      <ol className="mt-5 space-y-3" aria-label={`Ranking de cashback de ${store.name}`}>
        {offers.map((offer, index) => {
          const signals = effectiveSignals(offer, isCorrentista);
          const previousText = formatPreviousValue(offer, isCorrentista);
          return (
            <li className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border p-4 sm:p-5 ${index === 0 ? "border-[#cfe7d9] bg-[#f2f9f5]" : "border-[#ece9e2] bg-white"}`} key={offer.platformId}>
              <span aria-label={`${index + 1}ª posição`} className="font-mono text-sm font-semibold text-[#5b5f56]">{String(index + 1).padStart(2, "0")}</span>
              <div className="min-w-32 flex-1">
                <p className="font-semibold">{offer.platformName}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  {index === 0 ? <span className="rounded-full bg-[#e7f4ec] px-2 py-1 font-mono font-medium text-[#1c7a4d]">MELHOR</span> : null}
                  {signals.isBoost ? <span className="rounded-full bg-[#fdece0] px-2 py-1 font-mono font-medium text-[#aa4a14]">BOOST</span> : null}
                  {offer.reward.type === "fixed" ? <span className="rounded-full bg-[#f0e7d3] px-2 py-1 font-mono font-medium text-[#805e26]">VALOR FIXO</span> : null}
                  {offer.freshness === "delayed" ? <span className="rounded-full bg-[#f0e7d3] px-2 py-1 font-mono font-medium text-[#805e26]">ATUALIZAÇÃO ATRASADA</span> : null}
                  {isInterCorrentistaOffer(offer) ? <span className="rounded-full bg-[#eef1ec] px-2 py-1 font-mono font-medium text-[#5b5f56]">{isCorrentista ? "TAXA CORRENTISTA" : "TAXA NÃO CORRENTISTA"}</span> : null}
                </div>
              </div>
              <div className="ml-auto text-right">
                <p className="font-numbers text-xl font-bold text-[#1c7a4d]">{formatReward(offer, isCorrentista)}</p>
                {offer.reward.type === "percent" && offer.reward.isUpto ? <p className="mt-1 text-xs text-[#5b5f56]">Teto anunciado pela plataforma</p> : null}
                {previousText ? <p className="mt-1 text-xs text-[#5b5f56]">Era {previousText}</p> : null}
              </div>
              <a aria-label={`Ativar cashback pela ${offer.platformName} (abre em nova aba)`} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d] ${index === 0 ? "bg-[#1c7a4d] text-white hover:bg-[#16633f]" : "border border-[#e0ddd4] bg-white text-[#12140f] hover:bg-[#f6f5f0]"}`} href={`/go/${encodeURIComponent(store.slug)}/${encodeURIComponent(offer.platformId)}`} rel="noopener noreferrer" target="_blank">Ativar <ExternalLink aria-hidden="true" size={16} /><span className="sr-only">(abre em nova aba)</span></a>
            </li>
          );
        })}
      </ol>
      <p className="mt-5 rounded-xl bg-[#faf9f5] p-4 text-sm leading-6 text-[#5b5f56]">As ofertas são informativas e podem mudar conforme as condições de cada plataforma. Confirme os detalhes antes de comprar.</p>
    </section>
  );
}
