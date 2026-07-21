"use client";

import { useMemo } from "react";
import type { StoreDetail } from "@/lib/catalog";
import {
  composeStoreHistory,
  groupSegmentsByRewardType,
  HISTORY_WINDOW_MS,
  summarizeSeries,
  type ComposedSeries,
  type HistorySegment,
  type RewardType,
} from "@/lib/history";
import { useInterPreference } from "@/lib/inter-preference";
import { INTER_PLATFORM_ID } from "@/lib/offer-ranking";

/**
 * Uma cor por plataforma (handoff) derivada da marca, mas escurecida até ≥3:1 sobre o card branco
 * — o laranja original do Inter (#ff6a00) fica em 2,87:1 e reprovaria a regra de contraste de
 * objetos gráficos. A cor nunca é o único código: o traço de cada série mantém um padrão de
 * tracejado próprio, repetido na legenda, para não depender de percepção de cor (WCAG 1.4.1).
 */
const LINE_COLORS: Record<string, string> = {
  meliuz: "#d81b60",
  cuponomia: "#0a66ff",
  mycashback: "#7c3aed",
  zoom: "#0f766e",
  inter: "#c2410c",
};
const FALLBACK_LINE_COLOR = "#3d4039";
const DASH_PATTERNS = ["none", "7 5", "2 4", "11 4 2 4", "1 5"];
const CHART_WIDTH = 640;
const CHART_HEIGHT = 160;
const CHART_PADDING = 28;

interface RenderedLine {
  platformId: string;
  platformName: string;
  variantLabel: string;
  series: ComposedSeries;
}

interface ChartLine {
  platformId: string;
  platformName: string;
  variantLabel: string;
  segments: HistorySegment[];
}

function formatWindowDate(instant: Date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(instant);
}

function lineColor(platformId: string) {
  return LINE_COLORS[platformId] ?? FALLBACK_LINE_COLOR;
}

function buildStepPath(segments: HistorySegment[], xScale: (instant: Date) => number, yScale: (value: number) => number) {
  let path = "";
  let previous: HistorySegment | null = null;
  for (const segment of segments) {
    const x1 = xScale(new Date(segment.from));
    const x2 = xScale(new Date(segment.to));
    const y = yScale(segment.value);
    const adjacent = previous !== null && new Date(previous.to).getTime() === new Date(segment.from).getTime();
    path += adjacent ? ` L ${x1} ${y} L ${x2} ${y}` : ` M ${x1} ${y} L ${x2} ${y}`;
    previous = segment;
  }
  return path.trim();
}

function HistoryChart({
  rewardType,
  lines,
  windowStart,
  windowEnd,
}: {
  rewardType: RewardType;
  lines: ChartLine[];
  windowStart: Date;
  windowEnd: Date;
}) {
  const allValues = lines.flatMap((line) => line.segments.map((segment) => segment.value));
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const padding = rawMin === rawMax ? Math.max(1, Math.abs(rawMin) * 0.1) : (rawMax - rawMin) * 0.12;
  const min = rawMin - padding;
  const max = rawMax + padding;

  const innerWidth = CHART_WIDTH - CHART_PADDING * 2;
  const innerHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const xScale = (instant: Date) =>
    CHART_PADDING + ((instant.getTime() - windowStart.getTime()) / (windowEnd.getTime() - windowStart.getTime())) * innerWidth;
  const yScale = (value: number) => CHART_PADDING + innerHeight - ((value - min) / (max - min)) * innerHeight;

  return (
    <div className="rounded-[18px] border border-[#ece9e2] bg-white px-5 py-[22px] sm:px-6">
      <p className="font-mono text-xs font-medium tracking-[0.04em] text-[#70736a]">
        {rewardType === "percent" ? "CASHBACK (%)" : "CASHBACK EM REAIS · VALOR FIXO"}
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-3">
        {lines.map((line, index) => (
          <li className="inline-flex items-center gap-[7px] text-[13px] text-[#3d4039]" key={`legend-${line.platformId}${line.variantLabel}`}>
            <svg aria-hidden="true" className="shrink-0" height={3} viewBox="0 0 16 3" width={16}>
              <line stroke={lineColor(line.platformId)} strokeDasharray={DASH_PATTERNS[index % DASH_PATTERNS.length]} strokeWidth={3} x1={0} x2={16} y1={1.5} y2={1.5} />
            </svg>
            {line.platformName}{line.variantLabel}
          </li>
        ))}
      </ul>
      <svg aria-hidden="true" className="mt-3 h-auto w-full" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
        <line stroke="#e0ddd4" strokeWidth={1} x1={CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} />
        {lines.map((line, index) => (
          <path
            d={buildStepPath(line.segments, xScale, yScale)}
            fill="none"
            key={line.platformId + line.variantLabel}
            stroke={lineColor(line.platformId)}
            strokeDasharray={DASH_PATTERNS[index % DASH_PATTERNS.length]}
            strokeLinejoin="round"
            strokeWidth={2}
          />
        ))}
        <text fill="#5b5f56" fontSize={10} x={CHART_PADDING} y={CHART_HEIGHT - 8}>{formatWindowDate(windowStart)}</text>
        <text fill="#5b5f56" fontSize={10} textAnchor="end" x={CHART_WIDTH - CHART_PADDING} y={CHART_HEIGHT - 8}>{formatWindowDate(windowEnd)}</text>
      </svg>
    </div>
  );
}

function selectStoreHistoryLines(store: StoreDetail, isCorrentista: boolean, now: Date) {
  const composed = composeStoreHistory(store.history, now);
  const hasInterPartial = composed.some((platform) => platform.platformId === INTER_PLATFORM_ID && platform.partial !== null);

  const lines: RenderedLine[] = composed.map((platform) => {
    const isInter = platform.platformId === INTER_PLATFORM_ID;
    const usePartial = isInter && !isCorrentista;
    // ADR-0011: uma série insuficiente do Inter nunca cai para a outra modalidade como fallback.
    const series = usePartial ? (platform.partial ?? { sufficient: false, segments: [] }) : platform.primary;
    return {
      platformId: platform.platformId,
      platformName: platform.platformName,
      variantLabel: isInter ? (isCorrentista ? " (correntista)" : " (não correntista)") : "",
      series,
    };
  });

  return { lines, hasInterPartial };
}

export function StoreHistory({ store }: { store: StoreDetail }) {
  const { isCorrentista } = useInterPreference();
  const now = useMemo(() => new Date(), []);
  const windowStart = useMemo(() => new Date(now.getTime() - HISTORY_WINDOW_MS), [now]);
  const { lines, hasInterPartial } = useMemo(() => selectStoreHistoryLines(store, isCorrentista, now), [store, isCorrentista, now]);

  const sufficientLines = lines.filter((line) => line.series.sufficient && line.series.segments.length > 0);
  const percentLines = sufficientLines
    .map((line) => ({ ...line, segments: groupSegmentsByRewardType(line.series.segments).percent }))
    .filter((line) => line.segments.length > 0);
  const fixedLines = sufficientLines
    .map((line) => ({ ...line, segments: groupSegmentsByRewardType(line.series.segments).fixed }))
    .filter((line) => line.segments.length > 0);
  const hasChart = percentLines.length > 0 || fixedLines.length > 0;

  return (
    <section aria-labelledby="history-heading" className="mt-11">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[22px] font-bold tracking-[-0.02em]" id="history-heading">Histórico</h2>
        {hasChart ? <span className="text-[13px] text-[#70736a]">últimos 60 dias</span> : null}
      </div>
      {hasInterPartial ? <p className="-mt-2 mb-3.5 text-[13px] text-[#70736a]">A série do Inter segue o toggle “Correntista Inter” do ranking acima.</p> : null}

      {hasChart ? (
        <div className="space-y-4">
          {percentLines.length > 0 ? <HistoryChart lines={percentLines} rewardType="percent" windowEnd={now} windowStart={windowStart} /> : null}
          {fixedLines.length > 0 ? <HistoryChart lines={fixedLines} rewardType="fixed" windowEnd={now} windowStart={windowStart} /> : null}
        </div>
      ) : (
        <div className="rounded-[18px] border border-dashed border-[#ddd9cf] bg-[#faf9f5] px-7 py-8 text-center">
          <p className="text-[17px] font-semibold text-[#12140f]">Histórico sendo construído</p>
          <p className="mx-auto mt-1.5 max-w-[470px] text-[14.5px] leading-[1.55] text-[#70736a]">Ainda estamos coletando os valores de cashback desta loja. Assim que houver dados suficientes, o gráfico dos últimos 60 dias aparece aqui.</p>
        </div>
      )}

      <ul className="mt-3.5 space-y-1.5 border-t border-[#f4f2eb] pt-3.5 text-[13.5px] leading-[1.55] text-[#70736a]">
        {lines.map((line) => (
          <li key={line.platformId + line.variantLabel}>{summarizeSeries(`${line.platformName}${line.variantLabel}`, line.series)}</li>
        ))}
      </ul>
    </section>
  );
}
