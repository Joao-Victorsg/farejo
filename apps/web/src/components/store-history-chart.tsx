"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { PlatformIcon } from "@/components/platform-icon";
import { ChartContainer } from "@/components/ui/chart";
import {
  buildHistoryChartModel,
  buildResponsiveHistoryTicks,
  formatHistoryValue,
  summarizeStoreHistory,
  type HistoryChartModel,
  type HistoryPresentationLine,
  type RewardType,
} from "@/lib/history";

const LINE_COLORS: Record<string, string> = {
  meliuz: "#d81b60",
  cuponomia: "#0a66ff",
  mycashback: "#7c3aed",
  zoom: "#0f766e",
  inter: "#c2410c",
};
const FALLBACK_LINE_COLOR = "#3d4039";
const DASH_PATTERNS = [undefined, "7 5", "2 4", "11 4 2 4", "1 5"];

function lineColor(platformId: string) {
  return LINE_COLORS[platformId] ?? FALLBACK_LINE_COLOR;
}

function formatChartDate(at: number) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(at));
}

function formatTooltipDate(at: number) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(at));
}

function useHistoryTicks(windowStart: Date, windowEnd: Date) {
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));

  useEffect(() => {
    function updateViewportWidth() {
      setViewportWidth(window.innerWidth);
    }

    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  return useMemo(
    () => buildResponsiveHistoryTicks(windowStart, windowEnd, viewportWidth),
    [viewportWidth, windowEnd, windowStart],
  );
}

function HistoryTooltip({
  active,
  label,
  model,
  rewardType,
  visibleIds,
}: Pick<TooltipContentProps<number, string>, "active" | "label"> & {
  model: HistoryChartModel;
  rewardType: RewardType;
  visibleIds: Set<string>;
}) {
  if (!active || typeof label !== "number") return null;
  const point = model.points.find((candidate) => candidate.at === label);
  if (!point) return null;

  return (
    <div className="min-w-[190px] rounded-xl border border-[#ddd9cf] bg-white/95 px-3.5 py-3 shadow-[0_10px_30px_rgba(18,20,15,0.12)] backdrop-blur-sm">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-[#70736a]">
        {formatTooltipDate(label)}
      </p>
      <ul className="mt-2 space-y-1.5">
        {model.availableLines.filter((line) => visibleIds.has(line.platformId)).map((line) => {
          const value = point.values[line.platformId];
          return (
            <li className="flex items-center justify-between gap-5 text-[13px]" key={line.platformId}>
              <span className="inline-flex items-center gap-2 text-[#3d4039]">
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: lineColor(line.platformId) }} />
                {line.platformName}{line.variantLabel}
              </span>
              <span className={`font-numbers font-semibold ${value === null ? "text-[#5b5f56]" : "text-[#12140f]"}`}>
                {value === null ? "sem dado" : formatHistoryValue(rewardType, value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChangeDot({
  cx,
  cy,
  payload,
  platformId,
}: {
  cx?: number;
  cy?: number;
  payload?: unknown;
  platformId: string;
}) {
  if (typeof cx !== "number" || typeof cy !== "number" || typeof payload !== "object" || payload === null) return <g />;
  const changes = "changes" in payload ? payload.changes : null;
  if (!Array.isArray(changes) || !changes.includes(platformId)) return <g />;
  return <circle cx={cx} cy={cy} fill="white" r={3.5} stroke={lineColor(platformId)} strokeWidth={2} />;
}

function LegendChip({
  line,
  visible,
  dashPattern,
  onToggle,
}: {
  line: HistoryPresentationLine;
  visible: boolean;
  dashPattern: string | undefined;
  onToggle: () => void;
}) {
  return (
    <button
      aria-pressed={visible}
      className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d] ${
        visible ? "border-[#d8d5cc] bg-white text-[#3d4039]" : "border-[#ece9e2] bg-[#f6f5f0] text-[#5b5f56]"
      }`}
      onClick={onToggle}
      type="button"
    >
      <PlatformIcon platformId={line.platformId} size={18} />
      {line.platformName}{line.variantLabel}
      <svg aria-hidden="true" className="ml-0.5 h-2 w-5" viewBox="0 0 20 8">
        <line
          opacity={visible ? 1 : 0.55}
          stroke={lineColor(line.platformId)}
          strokeDasharray={dashPattern}
          strokeWidth="2.5"
          x1="0"
          x2="20"
          y1="4"
          y2="4"
        />
      </svg>
    </button>
  );
}

function CollectingChip({ line }: { line: HistoryPresentationLine }) {
  return (
    <span
      aria-label={`${line.platformName}${line.variantLabel}: histórico sendo construído`}
      className="inline-flex min-h-9 items-center gap-2 rounded-full border border-dashed border-[#ddd9cf] bg-[#faf9f5] px-3 py-1.5 text-[12.5px] text-[#5b5f56]"
    >
      <span className="opacity-55"><PlatformIcon platformId={line.platformId} size={18} /></span>
      {line.platformName}{line.variantLabel}
      <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.04em] text-[#5b5f56]">coletando</span>
    </span>
  );
}

export function StoreHistoryChart({
  lines,
  rewardType,
  storeName,
  windowEnd,
  windowStart,
}: {
  lines: HistoryPresentationLine[];
  rewardType: RewardType;
  storeName: string;
  windowEnd: Date;
  windowStart: Date;
}) {
  const model = useMemo(
    () => buildHistoryChartModel(lines, rewardType, windowStart, windowEnd),
    [lines, rewardType, windowEnd, windowStart],
  );
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const visibleLines = model.availableLines.filter((line) => !hiddenIds.has(line.platformId));
  const effectiveLines = visibleLines.length > 0 ? visibleLines : model.availableLines;
  const visibleIds = new Set(effectiveLines.map((line) => line.platformId));
  const hasHidden = effectiveLines.length < model.availableLines.length;
  const summary = summarizeStoreHistory(storeName, rewardType, model.availableLines);
  const ticks = useHistoryTicks(windowStart, windowEnd);

  function toggleLine(platformId: string) {
    setHiddenIds((current) => {
      const next = new Set(current);
      if (next.has(platformId)) {
        next.delete(platformId);
      } else if (model.availableLines.length - next.size > 1) {
        next.add(platformId);
      }
      return next;
    });
  }

  if (model.availableLines.length === 0) {
    return (
      <article className="rounded-[18px] border border-dashed border-[#ddd9cf] bg-[#faf9f5] px-4 py-5 sm:px-6">
        <p className="font-mono text-xs font-medium tracking-[0.04em] text-[#5b5f56]">
          {rewardType === "percent" ? "CASHBACK (%)" : "CASHBACK EM REAIS · VALOR FIXO"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {model.collectingLines.map((line) => <CollectingChip key={line.platformId} line={line} />)}
        </div>
        <p className="mt-4 text-sm text-[#5b5f56]">Histórico sendo construído.</p>
      </article>
    );
  }

  return (
    <div>
    <article className="rounded-[18px] border border-[#e5e1d8] bg-white px-4 py-5 shadow-[0_1px_0_rgba(18,20,15,0.02)] sm:px-6 sm:py-[22px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs font-medium tracking-[0.04em] text-[#5b5f56]">
          {rewardType === "percent" ? "CASHBACK (%)" : "CASHBACK EM REAIS · VALOR FIXO"}
        </p>
        {hasHidden ? (
          <button
            className="text-[12.5px] font-semibold text-[#1c7a4d] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d]"
            onClick={() => setHiddenIds(new Set())}
            type="button"
          >
            Mostrar todas
          </button>
        ) : null}
      </div>

      <div aria-label={`Séries do histórico de ${rewardType === "percent" ? "cashback percentual" : "valor fixo"}`} className="mt-3 flex flex-wrap gap-2">
        {model.availableLines.map((line, index) => (
          <LegendChip
            dashPattern={DASH_PATTERNS[index % DASH_PATTERNS.length]}
            key={line.platformId}
            line={line}
            onToggle={() => toggleLine(line.platformId)}
            visible={visibleIds.has(line.platformId)}
          />
        ))}
        {model.collectingLines.map((line) => <CollectingChip key={`collecting-${line.platformId}`} line={line} />)}
      </div>

      <ChartContainer className="mt-2">
        <LineChart
          accessibilityLayer
          data={model.points}
          desc={summary ?? `Histórico de ${storeName} nos últimos 60 dias.`}
          margin={{ bottom: 6, left: 0, right: 12, top: 14 }}
          title={`Gráfico dos últimos 60 dias de ${storeName}`}
        >
          <CartesianGrid horizontal stroke="#e9e6de" strokeDasharray="3 5" vertical={false} />
          <XAxis
            axisLine={{ stroke: "#d8d5cc" }}
            dataKey="at"
            domain={[windowStart.getTime(), windowEnd.getTime()]}
            interval={0}
            scale="time"
            tick={{ fontSize: 11 }}
            tickFormatter={formatChartDate}
            tickLine={false}
            ticks={ticks}
            type="number"
          />
          <YAxis
            axisLine={false}
            domain={model.valueDomain}
            tick={{ fontSize: 11 }}
            tickCount={4}
            tickFormatter={(value: number) => formatHistoryValue(rewardType, value)}
            tickLine={false}
            ticks={model.valueTicks}
            width={rewardType === "percent" ? 46 : 64}
          />
          <Tooltip
            content={(props) => <HistoryTooltip {...props} model={model} rewardType={rewardType} visibleIds={visibleIds} />}
            cursor={{ stroke: "#8a8f84", strokeDasharray: "3 4", strokeWidth: 1 }}
            filterNull={false}
            isAnimationActive="auto"
          />
          {model.availableLines.map((line, index) => (
            <Line
              activeDot={{ fill: "white", r: 5, stroke: lineColor(line.platformId), strokeWidth: 2.5 }}
              connectNulls={false}
              dataKey={`values.${line.platformId}`}
              dot={<ChangeDot platformId={line.platformId} />}
              hide={!visibleIds.has(line.platformId)}
              // Recharts 3 revela a linha animando `stroke-dasharray` via requestAnimationFrame
              // (LineDrawShape + useAnimatedLineLength). Enquanto a animação corre, o traçado
              // fica cortado num ponto que depende do comprimento total de CADA path — e o
              // `animations: "disabled"` do Playwright só congela CSS/Web Animations, nunca rAF.
              // Com isso a captura visual congelava um quadro arbitrário do meio da animação
              // (baselines com o último patamar faltando, cada série cortada num lugar).
              // Sem animação, o gráfico nasce completo: nada a esperar, nada a estabilizar.
              isAnimationActive={false}
              key={line.platformId}
              name={`${line.platformName}${line.variantLabel}`}
              stroke={lineColor(line.platformId)}
              strokeDasharray={DASH_PATTERNS[index % DASH_PATTERNS.length]}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              type="stepAfter"
            />
          ))}
        </LineChart>
      </ChartContainer>

    </article>
      {summary ? <p className="mt-3 px-1 text-[14px] leading-[1.6] text-[#5b5f56]">{summary}</p> : null}
    </div>
  );
}
