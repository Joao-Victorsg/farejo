"use client";

import { FreshnessSummary } from "@/components/freshness-summary";
import type { StoreDetail } from "@/lib/catalog";
import { useInterPreference } from "@/lib/inter-preference";
import { formatReward, rankOffers } from "@/lib/offer-ranking";

/**
 * Cabeçalho do detalhe (handoff): identidade da loja à esquerda e o melhor cashback como o
 * elemento de maior peso visual à direita. Cliente porque o melhor valor — e quem o oferece —
 * dependem da preferência Inter, exatamente como o ranking logo abaixo.
 */
export function StoreHeader({ store }: { store: StoreDetail }) {
  const { isCorrentista } = useInterPreference();
  const offers = rankOffers(store.offers, isCorrentista);
  const best = offers[0] ?? null;
  const initial = store.name.trim().charAt(0).toLocaleUpperCase("pt-BR") || "L";
  const oldestSeenAt = offers.reduce<string | null>((oldest, offer) => !oldest || offer.lastSeenAt < oldest ? offer.lastSeenAt : oldest, null);

  return (
    <header className="mt-6 flex flex-wrap items-center gap-x-[22px] gap-y-5 rounded-[20px] border border-[#ece9e2] bg-white p-6 sm:p-8">
      {store.logoUrl
        ? <img alt="" aria-hidden="true" className="size-[76px] shrink-0 rounded-[20px] object-contain" height={76} src={store.logoUrl} width={76} />
        : <span aria-hidden="true" className="flex size-[76px] shrink-0 items-center justify-center rounded-[20px] bg-[#e7f4ec] font-mono text-[32px] font-bold text-[#1c7a4d]">{initial}</span>}
      <div className="min-w-48 flex-1">
        <h1 className="text-[32px] font-bold leading-[1.1] tracking-[-0.025em]">{store.name}</h1>
        {best ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[14.5px] text-[#70736a]">
            {offers.length} {offers.length === 1 ? "plataforma de cashback comparada" : "plataformas de cashback comparadas"}
            {oldestSeenAt ? <><span aria-hidden="true">·</span><FreshnessSummary lastSeenAt={oldestSeenAt} /></> : null}
          </p>
        ) : (
          <p className="mt-1.5 text-[14.5px] text-[#70736a]">Nenhuma plataforma com cashback ativo agora</p>
        )}
      </div>
      {best ? (
        <div className="text-right">
          <p className={`font-numbers text-[44px] font-semibold leading-none tracking-[-0.03em] ${best.reward.type === "fixed" ? "text-[#8a6a33]" : "text-[#1c7a4d]"}`}>{formatReward(best, isCorrentista)}</p>
          <p className="mt-1.5 text-[13px] text-[#70736a]">melhor · via {best.platformName}</p>
        </div>
      ) : null}
    </header>
  );
}
