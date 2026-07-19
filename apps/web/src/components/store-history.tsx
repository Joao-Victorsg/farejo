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

function formatWindowDate(instant: Date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(instant);
}

function formatAxisValue(rewardType: RewardType, value: number) {
  return rewardType === "percent"
    ? `${value.toLocaleString("pt-BR")}%`
    : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
  lines: { platformId: string; platformName: string; variantLabel: string; segments: HistorySegment[] }[];
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
    <div className="rounded-2xl border border-[#ece9e2] bg-white p-4 sm:p-5">
      <p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">
        {rewardType === "percent" ? "PERCENTUAL" : "VALOR FIXO"}
      </p>
      <svg aria-hidden="true" className="mt-3 h-auto w-full" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
        <line stroke="#e0ddd4" strokeWidth={1} x1={CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} />
        {lines.map((line, index) => (
          <path
            d={buildStepPath(line.segments, xScale, yScale)}
            fill="none"
            key={line.platformId + line.variantLabel}
            stroke="#1c7a4d"
            strokeDasharray={DASH_PATTERNS[index % DASH_PATTERNS.length]}
            strokeLinejoin="round"
            strokeWidth={2}
          />
        ))}
        {lines.map((line) => {
          const last = line.segments.at(-1);
          if (!last) return null;
          const x = xScale(new Date(last.to));
          const y = yScale(last.value);
          return (
            <text dy={-6} fill="#12140f" fontSize={10} key={`label-${line.platformId}${line.variantLabel}`} textAnchor="end" x={Math.min(x, CHART_WIDTH - CHART_PADDING)} y={y}>
              {line.platformName}
              {line.variantLabel} · {formatAxisValue(rewardType, last.value)}
            </text>
          );
        })}
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

  return (
    <section aria-labelledby="history-heading" className="mt-8">
      <div>
        <p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">ÚLTIMOS 60 DIAS</p>
        <h2 className="mt-2 text-3xl font-bold tracking-[-0.04em]" id="history-heading">Histórico de cashback</h2>
        {hasInterPartial ? <p className="mt-1 text-xs text-[#5b5f56]">A série do Inter segue o toggle “Correntista Inter” do ranking acima.</p> : null}
      </div>

      {percentLines.length === 0 && fixedLines.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-[#e0ddd4] bg-[#faf9f5] p-6 text-center">
          <p className="font-mono text-xs font-medium tracking-[0.13em] text-[#805e26]">HISTÓRICO SENDO CONSTRUÍDO</p>
          <p className="mt-2 text-sm text-[#5b5f56]">Ainda não observamos mudanças suficientes nos últimos 60 dias para mostrar um gráfico.</p>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {percentLines.length > 0 ? <HistoryChart lines={percentLines} rewardType="percent" windowEnd={now} windowStart={windowStart} /> : null}
          {fixedLines.length > 0 ? <HistoryChart lines={fixedLines} rewardType="fixed" windowEnd={now} windowStart={windowStart} /> : null}
        </div>
      )}

      <ul className="mt-4 space-y-1 text-sm text-[#5b5f56]">
        {lines.map((line) => (
          <li key={line.platformId + line.variantLabel}>{summarizeSeries(`${line.platformName}${line.variantLabel}`, line.series)}</li>
        ))}
      </ul>
    </section>
  );
}
