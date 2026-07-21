"use client";

import { ExternalLink } from "lucide-react";
import { InterToggle } from "@/components/inter-toggle";
import { PlatformIcon } from "@/components/platform-icon";
import type { CatalogOffer, StoreDetail } from "@/lib/catalog";
import { useInterPreference } from "@/lib/inter-preference";
import { effectiveSignals, formatPreviousValue, formatReward, isInterCorrentistaOffer, rankOffers } from "@/lib/offer-ranking";

const BADGE = "rounded-[5px] px-[7px] py-[3px] font-mono text-[10px] tracking-[0.03em]";

/**
 * Um único sinal secundário por linha, na prioridade do handoff: boost › condicional › valor fixo.
 * "Atrasado" fica de fora porque é sinal de frescor, não de natureza da oferta, e acumula com este.
 */
function secondaryBadge(offer: CatalogOffer, isCorrentista: boolean) {
  if (effectiveSignals(offer, isCorrentista).isBoost) return { label: "BOOST", cls: "bg-[#aa4a14] font-semibold text-white", title: "Cashback acima do valor típico dos últimos 60 dias" };
  if (isInterCorrentistaOffer(offer)) return { label: "CONDICIONAL", cls: "bg-[#dcebe3] font-semibold text-[#2f6f57]", title: "Taxa condicionada a ser correntista Inter" };
  // #8a6a33 (handoff) sobre #f0e7d3 fica em 4,07:1 — abaixo do mínimo AA para texto pequeno.
  if (offer.reward.type === "fixed") return { label: "VALOR FIXO", cls: "bg-[#f0e7d3] font-semibold text-[#805e26]", title: "Cashback em reais, não em porcentagem" };
  return null;
}

export function StoreRanking({ store }: { store: StoreDetail }) {
  const { isCorrentista } = useInterPreference();
  const offers = rankOffers(store.offers, isCorrentista);

  return (
    <section className="mt-11" aria-labelledby="ranking-heading">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-1">
        <h2 className="text-[15px] font-semibold text-[#5b5f56]" id="ranking-heading">Ranking de cashback</h2>
        {offers.some((offer) => isInterCorrentistaOffer(offer)) ? <InterToggle compact /> : null}
      </div>
      <ol className="space-y-3" aria-label={`Ranking de cashback de ${store.name}`}>
        {offers.map((offer, index) => {
          const isBest = index === 0;
          const isFixed = offer.reward.type === "fixed";
          const secondary = secondaryBadge(offer, isCorrentista);
          const previousText = formatPreviousValue(offer, isCorrentista);
          const isUpto = offer.reward.type === "percent" && offer.reward.isUpto;
          // A melhor oferta em R$ só encabeça o ranking quando não há nenhuma percentual: aí ela
          // ganha a paleta âmbar em vez da verde, para não sugerir comparação entre grandezas.
          const rowCls = !isBest ? "border-[#ece9e2] bg-white" : isFixed ? "border-[#e6d9bd] bg-[#faf6ec]" : "border-[#cfe7d9] bg-[#f2f9f5]";
          const valueCls = isFixed ? "text-[#8a6a33]" : isBest ? "text-[#1c7a4d]" : "text-[#3d4039]";
          const buttonCls = !isBest ? "border border-[#e0ddd4] bg-white text-[#12140f] hover:bg-[#f6f5f0]" : isFixed ? "bg-[#8a6a33] text-white hover:bg-[#755729]" : "bg-[#1c7a4d] text-white hover:bg-[#16633f]";
          return (
            <li className={`flex flex-wrap items-center gap-x-[18px] gap-y-3 rounded-2xl border px-4 py-[18px] sm:px-[22px] ${rowCls}`} key={offer.platformId}>
              <span aria-label={`${index + 1}ª posição`} className="w-5 shrink-0 text-center font-mono text-sm font-medium text-[#5b5f56]">{index + 1}</span>
              <PlatformIcon platformId={offer.platformId} size={46} />
              <div className="min-w-32 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <span className="text-[17px] font-semibold">{offer.platformName}</span>
                  {isBest ? <span className={`${BADGE} bg-[#e7f4ec] font-medium text-[#1c7a4d]`}>MELHOR</span> : null}
                  {secondary ? <span className={`${BADGE} ${secondary.cls}`} title={secondary.title}>{secondary.label}</span> : null}
                  {offer.freshness === "delayed" ? <span className={`${BADGE} bg-[#f6efda] font-semibold text-[#805e26]`} title="Verificada há mais de 24 h">ATRASADO</span> : null}
                </div>
                {isUpto || previousText ? (
                  <p className="mt-1 text-[13px] text-[#70736a]">
                    {isUpto ? "Teto anunciado pela plataforma" : null}
                    {isUpto && previousText ? " · " : null}
                    {previousText ? <>antes <s>{previousText}</s></> : null}
                  </p>
                ) : null}
              </div>
              <span className={`ml-auto min-w-[70px] text-right font-numbers text-[28px] font-semibold leading-none tracking-[-0.02em] ${valueCls}`}>{formatReward(offer, isCorrentista)}</span>
              <a aria-label={`Ativar cashback pela ${offer.platformName} (abre em nova aba)`} className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-[10px] px-[18px] text-[14.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d] ${buttonCls}`} href={`/go/${encodeURIComponent(store.slug)}/${encodeURIComponent(offer.platformId)}`} rel="noopener noreferrer" target="_blank">Ativar <ExternalLink aria-hidden="true" size={15} /><span className="sr-only">(abre em nova aba)</span></a>
            </li>
          );
        })}
      </ol>
      <p className="mt-6 rounded-[14px] bg-[#f6f5f0] px-[22px] py-[18px] text-[13.5px] leading-[1.55] text-[#5b5f56]">Os valores são informativos e podem variar por categoria de produto e pelas condições de cada plataforma. O botão <b className="font-semibold text-[#12140f]">Ativar</b> abre a plataforma escolhida em uma nova aba para redirecionar você à loja.</p>
    </section>
  );
}
