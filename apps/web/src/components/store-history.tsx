"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HistoryRangeSelector } from "@/components/history-range-selector";
import type { StoreDetail } from "@/lib/catalog";
import {
  buildHistoryRangeOptions,
  clipSeriesToWindow,
  composeStoreHistory,
  describeHistoryAvailability,
  findHistoryRangeOption,
  HISTORY_WINDOW_MS,
  pickDefaultHistoryRange,
  resolveHistoryWindow,
  summarizeSeries,
  type HistoryPresentationLine,
  type HistoryRangeOption,
} from "@/lib/history";
import { useInterPreference } from "@/lib/inter-preference";
import { INTER_PLATFORM_ID, rankOffers } from "@/lib/offer-ranking";

const RANGE_PARAM = "periodo";

const StoreHistoryChart = dynamic(
  () => import("@/components/store-history-chart").then((module) => module.StoreHistoryChart),
  {
    ssr: false,
    loading: () => <div aria-label="Carregando gráfico" className="h-[260px] animate-pulse rounded-[18px] border border-[#ece9e2] bg-[#faf9f5] sm:h-[300px]" role="status" />,
  },
);

function formatAvailabilityDate(at: Date) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(at);
}

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

  // A legenda espelha o ranking acima em vez de ordenar por nome: `rankOffers` já aplica a regra
  // de percentual antes de valor fixo e respeita o toggle do Inter, então a plataforma que paga
  // mais também recebe o traço contínuo (o padrão de traço é indexado pela posição).
  const rank = new Map(rankOffers(store.offers, isCorrentista).map((offer, index) => [offer.platformId, index]));
  lines.sort((left, right) => (rank.get(left.platformId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.platformId) ?? Number.MAX_SAFE_INTEGER));

  return { lines, hasInterPartial };
}

export function StoreHistory({ store }: { store: StoreDetail }) {
  const { isCorrentista } = useInterPreference();
  const now = useMemo(() => new Date(), []);
  const servedStart = useMemo(() => new Date(now.getTime() - HISTORY_WINDOW_MS), [now]);
  const { lines: servedLines, hasInterPartial } = useMemo(() => selectStoreHistoryLines(store, isCorrentista, now), [store, isCorrentista, now]);

  const availability = useMemo(() => describeHistoryAvailability(servedLines, servedStart, now), [servedLines, servedStart, now]);
  const options = useMemo(() => buildHistoryRangeOptions(availability), [availability]);
  const defaultOption = useMemo(() => pickDefaultHistoryRange(options, servedLines, availability, now), [options, servedLines, availability, now]);

  // A escolha vive na URL (mesmo padrão da ordenação do catálogo), mas é lida e escrita no
  // cliente: ler via `searchParams` da página faria cada troca de período custar um round-trip
  // RSC — refazendo a query do detalhe inteiro — para redesenhar um gráfico cujos 60 dias já
  // estão no payload.
  const [requestedRangeId, setRequestedRangeId] = useState<string | null>(null);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get(RANGE_PARAM);
    if (fromUrl !== null) setRequestedRangeId(fromUrl);
  }, []);

  const activeOption = findHistoryRangeOption(options, requestedRangeId) ?? defaultOption;
  const historyWindow = useMemo(
    () => (activeOption ? resolveHistoryWindow(activeOption, availability, now) : null),
    [activeOption, availability, now],
  );

  const selectRange = useCallback((option: HistoryRangeOption) => {
    setRequestedRangeId(option.id);
    const url = new URL(window.location.href);
    // Um período igual ao padrão não precisa sujar a URL — quem compartilha o link compartilha
    // a mesma leitura de qualquer jeito.
    if (option.id === defaultOption?.id) url.searchParams.delete(RANGE_PARAM);
    else url.searchParams.set(RANGE_PARAM, option.id);
    window.history.replaceState(null, "", url);
  }, [defaultOption]);

  const lines = useMemo(
    () => (historyWindow === null
      ? servedLines
      : servedLines.map((line) => ({ ...line, series: clipSeriesToWindow(line.series, historyWindow.start, historyWindow.end) }))),
    [servedLines, historyWindow],
  );

  const hasPercentChart = lines.some((line) => line.series.sufficient && line.series.segments.some((segment) => segment.rewardType === "percent"));
  const hasFixedChart = lines.some((line) => line.series.sufficient && line.series.segments.some((segment) => segment.rewardType === "fixed"));
  const hasChart = historyWindow !== null && (hasPercentChart || hasFixedChart);
  const showPercentCard = hasPercentChart || (hasChart && lines.some((line) => line.currentRewardType === "percent"));
  const showFixedCard = hasFixedChart || (hasChart && lines.some((line) => line.currentRewardType === "fixed"));

  return (
    <section aria-labelledby="history-heading" className="mt-11">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
        <h2 className="text-[22px] font-bold tracking-[-0.02em]" id="history-heading">Histórico</h2>
        {hasChart && options.length > 1 && activeOption ? (
          <HistoryRangeSelector onChange={selectRange} options={options} value={activeOption.id} />
        ) : null}
      </div>
      {hasChart && availability.from ? (
        <p className="-mt-2 mb-3.5 text-[13px] text-[#70736a]">
          Dados disponíveis desde {formatAvailabilityDate(availability.from)} · {availability.days} {availability.days === 1 ? "dia" : "dias"}
        </p>
      ) : null}
      {hasInterPartial ? <p className="-mt-2 mb-3.5 text-[13px] text-[#70736a]">A série do Inter segue o toggle “Correntista Inter” do ranking acima.</p> : null}

      {hasChart && historyWindow ? (
        <div className="space-y-4">
          {showPercentCard ? <StoreHistoryChart historyWindow={historyWindow} lines={lines} rewardType="percent" storeName={store.name} /> : null}
          {showFixedCard ? <StoreHistoryChart historyWindow={historyWindow} lines={lines} rewardType="fixed" storeName={store.name} /> : null}
        </div>
      ) : (
        <div className="rounded-[18px] border border-dashed border-[#ddd9cf] bg-[#faf9f5] px-7 py-8 text-center">
          <p className="text-[17px] font-semibold text-[#12140f]">Histórico sendo construído</p>
          <p className="mx-auto mt-1.5 max-w-[470px] text-[14.5px] leading-[1.55] text-[#70736a]">Ainda estamos coletando os valores de cashback desta loja. Assim que houver dados suficientes, o gráfico aparece aqui.</p>
        </div>
      )}

      <ul className="sr-only">
        {lines.map((line) => (
          <li key={line.platformId + line.variantLabel}>
            {historyWindow ? summarizeSeries(`${line.platformName}${line.variantLabel}`, line.series, historyWindow) : `${line.platformName}${line.variantLabel}: histórico sendo construído.`}
          </li>
        ))}
      </ul>
    </section>
  );
}
