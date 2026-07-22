"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { StoreDetail } from "@/lib/catalog";
import {
  composeStoreHistory,
  HISTORY_WINDOW_MS,
  summarizeSeries,
  type HistoryPresentationLine,
} from "@/lib/history";
import { useInterPreference } from "@/lib/inter-preference";
import { INTER_PLATFORM_ID } from "@/lib/offer-ranking";

const StoreHistoryChart = dynamic(
  () => import("@/components/store-history-chart").then((module) => module.StoreHistoryChart),
  {
    ssr: false,
    loading: () => <div aria-label="Carregando gráfico" className="h-[260px] animate-pulse rounded-[18px] border border-[#ece9e2] bg-[#faf9f5] sm:h-[300px]" role="status" />,
  },
);

function selectStoreHistoryLines(store: StoreDetail, isCorrentista: boolean, now: Date) {
  const composed = composeStoreHistory(store.history, now);
  const hasInterPartial = composed.some((platform) => platform.platformId === INTER_PLATFORM_ID && platform.partial !== null);
  const currentRewardTypes = new Map(store.offers.map((offer) => [offer.platformId, offer.reward.type]));

  const lines: HistoryPresentationLine[] = composed.map((platform) => {
    const isInter = platform.platformId === INTER_PLATFORM_ID;
    const usePartial = isInter && !isCorrentista;
    // ADR-0011: uma série insuficiente do Inter nunca cai para a outra modalidade como fallback.
    const series = usePartial ? (platform.partial ?? { sufficient: false, segments: [] }) : platform.primary;
    return {
      platformId: platform.platformId,
      platformName: platform.platformName,
      variantLabel: isInter ? (isCorrentista ? " (correntista)" : " (não correntista)") : "",
      currentRewardType: currentRewardTypes.get(platform.platformId) ?? platform.primary.segments.at(-1)?.rewardType ?? null,
      series,
    };
  });

  const representedPlatforms = new Set(lines.map((line) => line.platformId));
  for (const offer of store.offers) {
    if (representedPlatforms.has(offer.platformId)) continue;
    const isInter = offer.platformId === INTER_PLATFORM_ID;
    lines.push({
      platformId: offer.platformId,
      platformName: offer.platformName,
      variantLabel: isInter ? (isCorrentista ? " (correntista)" : " (não correntista)") : "",
      currentRewardType: offer.reward.type,
      series: { sufficient: false, segments: [] },
    });
  }
  lines.sort((left, right) => left.platformName.localeCompare(right.platformName, "pt-BR"));

  return { lines, hasInterPartial };
}

export function StoreHistory({ store }: { store: StoreDetail }) {
  const { isCorrentista } = useInterPreference();
  const now = useMemo(() => new Date(), []);
  const windowStart = useMemo(() => new Date(now.getTime() - HISTORY_WINDOW_MS), [now]);
  const { lines, hasInterPartial } = useMemo(() => selectStoreHistoryLines(store, isCorrentista, now), [store, isCorrentista, now]);

  const hasPercentChart = lines.some((line) => line.series.sufficient && line.series.segments.some((segment) => segment.rewardType === "percent"));
  const hasFixedChart = lines.some((line) => line.series.sufficient && line.series.segments.some((segment) => segment.rewardType === "fixed"));
  const hasChart = hasPercentChart || hasFixedChart;
  const showPercentCard = hasPercentChart || (hasChart && lines.some((line) => line.currentRewardType === "percent"));
  const showFixedCard = hasFixedChart || (hasChart && lines.some((line) => line.currentRewardType === "fixed"));

  return (
    <section aria-labelledby="history-heading" className="mt-11">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[22px] font-bold tracking-[-0.02em]" id="history-heading">Histórico</h2>
        {hasChart ? <span className="text-[13px] text-[#70736a]">últimos 60 dias</span> : null}
      </div>
      {hasInterPartial ? <p className="-mt-2 mb-3.5 text-[13px] text-[#70736a]">A série do Inter segue o toggle “Correntista Inter” do ranking acima.</p> : null}

      {hasChart ? (
        <div className="space-y-4">
          {showPercentCard ? <StoreHistoryChart lines={lines} rewardType="percent" storeName={store.name} windowEnd={now} windowStart={windowStart} /> : null}
          {showFixedCard ? <StoreHistoryChart lines={lines} rewardType="fixed" storeName={store.name} windowEnd={now} windowStart={windowStart} /> : null}
        </div>
      ) : (
        <div className="rounded-[18px] border border-dashed border-[#ddd9cf] bg-[#faf9f5] px-7 py-8 text-center">
          <p className="text-[17px] font-semibold text-[#12140f]">Histórico sendo construído</p>
          <p className="mx-auto mt-1.5 max-w-[470px] text-[14.5px] leading-[1.55] text-[#70736a]">Ainda estamos coletando os valores de cashback desta loja. Assim que houver dados suficientes, o gráfico dos últimos 60 dias aparece aqui.</p>
        </div>
      )}

      <ul className="sr-only">
        {lines.map((line) => (
          <li key={line.platformId + line.variantLabel}>{summarizeSeries(`${line.platformName}${line.variantLabel}`, line.series)}</li>
        ))}
      </ul>
    </section>
  );
}
