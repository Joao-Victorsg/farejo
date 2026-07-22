const WINDOW_DAYS = 60;
export const HISTORY_WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

export type RewardType = "percent" | "fixed";

/** Uma linha de `web_read.store_history`: um evento delta de `offer_history`, já com a âncora incluída. */
export interface StoreHistoryRow {
  platformId: string;
  platformName: string;
  rewardType: RewardType;
  value: number | null;
  valuePartial: number | null;
  changedAt: string;
}

interface RawSeriesEvent {
  rewardType: RewardType;
  value: number | null;
  changedAt: string;
}

export interface HistorySegment {
  rewardType: RewardType;
  from: string;
  to: string;
  value: number;
}

export interface ComposedSeries {
  /** Há ao menos uma mudança real observável dentro do alcance da janela (âncora + eventos). */
  sufficient: boolean;
  /** Trechos em degrau já cortados na janela; lacunas entre trechos são períodos inativos/desconhecidos. */
  segments: HistorySegment[];
}

export interface HistoryPresentationLine {
  platformId: string;
  platformName: string;
  variantLabel: string;
  currentRewardType: RewardType | null;
  series: ComposedSeries;
}

export interface HistoryChartPoint {
  at: number;
  values: Record<string, number | null>;
  changes: string[];
}

export interface HistoryChartModel {
  points: HistoryChartPoint[];
  ticks: number[];
  valueDomain: [number, number];
  valueTicks: number[];
  availableLines: HistoryPresentationLine[];
  collectingLines: HistoryPresentationLine[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function valueAt(segments: HistorySegment[], at: number, windowEnd: number): number | null {
  for (const segment of segments) {
    const from = new Date(segment.from).getTime();
    const to = new Date(segment.to).getTime();
    if (from <= at && (at < to || (at === windowEnd && to === windowEnd))) return segment.value;
  }
  return null;
}

export function buildResponsiveHistoryTicks(windowStart: Date, windowEnd: Date, viewportWidth: number): number[] {
  const start = windowStart.getTime();
  const end = windowEnd.getTime();
  if (end <= start) return [start];

  if (viewportWidth < 640) {
    const span = end - start;
    return [start, start + span / 3, start + (span * 2) / 3, end].map(Math.round);
  }

  const interval = viewportWidth < 1024 ? 2 * WEEK_MS : WEEK_MS;
  const ticks = [start];
  for (let at = start + interval; at < end; at += interval) ticks.push(at);
  ticks.push(end);
  return ticks;
}

function roundTick(value: number): number {
  return Number(value.toFixed(6));
}

function buildValueScale(values: number[]): { domain: [number, number]; ticks: number[] } {
  if (values.length === 0) return { domain: [0, 1], ticks: [0, 1] };
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  if (rawMin === rawMax) {
    const padding = Math.max(1, Math.abs(rawMin) * 0.1);
    const domain: [number, number] = [Math.max(0, rawMin - padding), rawMax + padding];
    const tickStep = (domain[1] - domain[0]) / 4;
    return {
      domain,
      ticks: Array.from({ length: 5 }, (_, index) => roundTick(domain[0] + tickStep * index)),
    };
  }

  const roughStep = (rawMax - rawMin) / 3;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = niceNormalized * magnitude;
  const firstTick = Math.floor(rawMin / step) * step;
  const lastTick = Math.ceil(rawMax / step) * step;
  const ticks: number[] = [];
  for (let tick = firstTick; tick <= lastTick + step / 1000; tick += step) ticks.push(roundTick(tick));

  return {
    domain: [Math.max(0, firstTick - step * 0.2), lastTick + step * 0.2],
    ticks,
  };
}

export function buildHistoryChartModel(
  lines: HistoryPresentationLine[],
  rewardType: RewardType,
  windowStart: Date,
  windowEnd: Date,
): HistoryChartModel {
  const availableLines = lines.filter(
    (line) => line.series.sufficient && line.series.segments.some((segment) => segment.rewardType === rewardType),
  );
  const availableIds = new Set(availableLines.map((line) => line.platformId));
  const collectingLines = lines.filter(
    (line) => line.currentRewardType === rewardType && !availableIds.has(line.platformId),
  );
  const start = windowStart.getTime();
  const end = windowEnd.getTime();
  const instants = new Set<number>([start, end]);

  for (let at = start + DAY_MS; at < end; at += DAY_MS) instants.add(at);
  for (const line of availableLines) {
    for (const segment of line.series.segments) {
      if (segment.rewardType !== rewardType) continue;
      const from = new Date(segment.from).getTime();
      const to = new Date(segment.to).getTime();
      instants.add(from);
      instants.add(to);
      // Recharts removes a null point from the path. Keep the left-hand value immediately
      // before every boundary so a line entering a gap reaches the real deactivation time
      // instead of stopping at the previous daily sample.
      if (to > start && to <= end) instants.add(Math.max(start, to - 1));
    }
  }

  const matchingSegments = new Map(
    availableLines.map((line) => [
      line.platformId,
      line.series.segments.filter((segment) => segment.rewardType === rewardType),
    ]),
  );
  const points = [...instants]
    .filter((at) => at >= start && at <= end)
    .sort((left, right) => left - right)
    .map((at): HistoryChartPoint => {
      const values: Record<string, number | null> = {};
      const changes: string[] = [];
      for (const line of availableLines) {
        const segments = matchingSegments.get(line.platformId) ?? [];
        values[line.platformId] = valueAt(segments, at, end);
        if (at > start && segments.some((segment) => new Date(segment.from).getTime() === at)) {
          changes.push(line.platformId);
        }
      }
      return { at, values, changes };
    });
  const values = availableLines.flatMap((line) =>
    line.series.segments.filter((segment) => segment.rewardType === rewardType).map((segment) => segment.value),
  );
  const valueScale = buildValueScale(values);

  return {
    points,
    ticks: buildResponsiveHistoryTicks(windowStart, windowEnd, Number.POSITIVE_INFINITY),
    valueDomain: valueScale.domain,
    valueTicks: valueScale.ticks,
    availableLines,
    collectingLines,
  };
}

/**
 * Compõe uma série delta-based (eventos + âncora anterior) em trechos em degrau dentro de
 * [windowStart, windowEnd]. `value: null` num evento é tratado como lacuna (nunca interpolado
 * nem convertido em zero) — ADR-0010. Eventos consecutivos com o mesmo (rewardType, value) são
 * fundidos: isso é o que torna "sufficient" honesto quando a única mudança observada pertence a
 * uma série irmã (ex.: value_partial mudou mas value não).
 */
export function composeHistorySeries(events: RawSeriesEvent[], windowStart: Date, windowEnd: Date): ComposedSeries {
  const sorted = [...events].sort((left, right) => left.changedAt.localeCompare(right.changedAt));

  const steps: { from: Date; to: Date; rewardType: RewardType; value: number | null }[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const event = sorted[index];
    if (!event) continue;
    const from = new Date(event.changedAt);
    const next = sorted[index + 1];
    const to = next ? new Date(next.changedAt) : windowEnd;
    if (to <= from) continue;
    steps.push({ from, to, rewardType: event.rewardType, value: event.value });
  }

  const clipped = steps
    .map((step) => ({ ...step, from: step.from < windowStart ? windowStart : step.from }))
    .filter((step) => step.to > windowStart && step.from < windowEnd);

  const merged: typeof clipped = [];
  for (const step of clipped) {
    const last = merged.at(-1);
    if (last && last.value === step.value && last.rewardType === step.rewardType && last.to.getTime() === step.from.getTime()) {
      last.to = step.to;
    } else {
      merged.push({ ...step });
    }
  }

  const segments: HistorySegment[] = [];
  for (const step of merged) {
    if (step.value === null) continue;
    segments.push({ rewardType: step.rewardType, from: step.from.toISOString(), to: step.to.toISOString(), value: step.value });
  }

  return { sufficient: merged.length >= 2, segments };
}

export interface StoreHistorySeries {
  platformId: string;
  platformName: string;
  /** Série correntista (Inter) ou única série (demais plataformas) — sempre a partir de `value`. */
  primary: ComposedSeries;
  /**
   * Série não correntista, só presente quando a plataforma já reportou `value_partial` alguma
   * vez (hoje, só Inter). `null` quando a plataforma nunca usa modalidade parcial.
   */
  partial: ComposedSeries | null;
}

/**
 * Agrupa as linhas por plataforma e compõe as duas séries possíveis. Eventos onde
 * `valuePartial` é `null` mas `value` está ativo (não-nulo) representam período **desconhecido**
 * para a modalidade parcial (pré-migration ou plataforma sem parcial) — são descartados da série
 * parcial em vez de virarem lacuna, porque "desconhecido" e "vimos que estava inativo" são fatos
 * diferentes (ADR-0011). Só entram na série parcial leituras reais (`valuePartial` não nulo) ou
 * desativação verdadeira (`value` e `valuePartial` nulos juntos).
 */
export function composeStoreHistory(rows: StoreHistoryRow[], now: Date): StoreHistorySeries[] {
  const windowStart = new Date(now.getTime() - HISTORY_WINDOW_MS);
  const byPlatform = new Map<string, StoreHistoryRow[]>();
  for (const row of rows) {
    const list = byPlatform.get(row.platformId) ?? [];
    list.push(row);
    byPlatform.set(row.platformId, list);
  }

  const result: StoreHistorySeries[] = [];
  for (const [platformId, platformRows] of byPlatform) {
    const platformName = platformRows[0]?.platformName ?? platformId;

    const primary = composeHistorySeries(
      platformRows.map((row) => ({ rewardType: row.rewardType, value: row.value, changedAt: row.changedAt })),
      windowStart,
      now,
    );

    const hasPartialSignal = platformRows.some((row) => row.valuePartial !== null);
    const partial = hasPartialSignal
      ? composeHistorySeries(
          platformRows
            .filter((row) => row.valuePartial !== null || row.value === null)
            .map((row) => ({ rewardType: row.rewardType, value: row.valuePartial, changedAt: row.changedAt })),
          windowStart,
          now,
        )
      : null;

    result.push({ platformId, platformName, primary, partial });
  }

  return result.sort((left, right) => left.platformName.localeCompare(right.platformName, "pt-BR"));
}

export interface OfferSignals {
  isBoost: boolean;
  typicalValue: number | null;
  previousValue: number | null;
  /** Sempre `null` hoje: nenhuma fonte fornece prazo explícito verdadeiro (ADR-0013). */
  validUntil: null;
}

const BOOST_MIN_ACTIVE_DAYS = 30;
const BOOST_MIN_ACTIVE_MS = BOOST_MIN_ACTIVE_DAYS * 24 * 60 * 60 * 1000;
const BOOST_FACTOR = 1.3;

/** Nem "sem baseline" nem "modalidade parcial sem histórico próprio" viram valores sintéticos. */
export const NO_OFFER_SIGNALS: OfferSignals = { isBoost: false, typicalValue: null, previousValue: null, validUntil: null };

function segmentDurationMs(segment: HistorySegment): number {
  return new Date(segment.to).getTime() - new Date(segment.from).getTime();
}

/** Mediana ponderada pela duração real de cada valor (ADR-0012) — não a mediana simples dos valores distintos. */
function weightedMedian(items: { value: number; weightMs: number }[]): number {
  const sorted = [...items].sort((left, right) => left.value - right.value);
  const total = sorted.reduce((sum, item) => sum + item.weightMs, 0);
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weightMs;
    if (cumulative >= total / 2) return item.value;
  }
  return sorted.at(-1)!.value;
}

/**
 * Deriva boost, valor típico e valor anterior de uma série já composta (ADR-0012/ADR-0013).
 * Nunca é persistido — recalculado a cada leitura a partir dos mesmos trechos em degraus do
 * gráfico de histórico. `series` pode conter trechos de outro `rewardType` (ex.: uma loja que
 * trocou de `%` para `R$`); só os trechos do `current.rewardType` entram na baseline — a
 * mediana ponderada nunca mistura escalas.
 */
export function deriveOfferSignals(
  series: ComposedSeries,
  current: { rewardType: RewardType; value: number },
  nativePrevious: { rewardType: RewardType; value: number } | null,
): OfferSignals {
  const matching = series.segments.filter((segment) => segment.rewardType === current.rewardType);
  const totalActiveMs = matching.reduce((sum, segment) => sum + segmentDurationMs(segment), 0);
  if (totalActiveMs < BOOST_MIN_ACTIVE_MS) return NO_OFFER_SIGNALS;

  const typicalValue = weightedMedian(matching.map((segment) => ({ value: segment.value, weightMs: segmentDurationMs(segment) })));
  const isBoost = current.value >= typicalValue * BOOST_FACTOR;
  if (!isBoost) return { isBoost: false, typicalValue, previousValue: null, validUntil: null };

  let previousValue: number | null = null;
  if (nativePrevious && nativePrevious.rewardType === current.rewardType) {
    previousValue = nativePrevious.value;
  } else {
    const last = series.segments.at(-1);
    const prev = series.segments.at(-2);
    const contiguous = last && prev && new Date(prev.to).getTime() === new Date(last.from).getTime();
    if (contiguous && last.rewardType === current.rewardType && prev.rewardType === current.rewardType) {
      previousValue = prev.value;
    }
  }

  return { isBoost: true, typicalValue, previousValue, validUntil: null };
}

/** Trechos de uma série, agrupados por `rewardType` — percentual e valor fixo nunca compartilham escala (ADR-0010). */
export function groupSegmentsByRewardType(segments: HistorySegment[]): Record<RewardType, HistorySegment[]> {
  const grouped: Record<RewardType, HistorySegment[]> = { percent: [], fixed: [] };
  for (const segment of segments) grouped[segment.rewardType].push(segment);
  return grouped;
}

function formatSegmentValue(segment: HistorySegment): string {
  return formatHistoryValue(segment.rewardType, segment.value);
}

export function formatHistoryValue(rewardType: RewardType, value: number): string {
  return rewardType === "percent"
    ? `${value.toLocaleString("pt-BR")}%`
    : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Resumo textual acessível de uma série já composta — não depende de cor nem hover (ADR-0010
 * frontend design "Detalhe, histórico e sinais"). Usado tanto como conteúdo visível quanto como
 * equivalente para leitor de tela.
 */
export function summarizeSeries(platformName: string, series: ComposedSeries): string {
  if (!series.sufficient || series.segments.length === 0) {
    return `${platformName}: histórico sendo construído.`;
  }

  const first = series.segments[0];
  const last = series.segments.at(-1);
  if (!first || !last) return `${platformName}: histórico sendo construído.`;

  const values = series.segments.map((segment) => segment.value);
  const minSegment = series.segments.reduce((lowest, segment) => (segment.value < lowest.value ? segment : lowest));
  const maxSegment = series.segments.reduce((highest, segment) => (segment.value > highest.value ? segment : highest));
  const changeCount = series.segments.length - 1;

  if (Math.min(...values) === Math.max(...values)) {
    return `${platformName}: manteve ${formatSegmentValue(last)} nos últimos ${WINDOW_DAYS} dias.`;
  }

  const changeWord = changeCount === 1 ? "mudança" : "mudanças";
  return `${platformName}: variou entre ${formatSegmentValue(minSegment)} e ${formatSegmentValue(maxSegment)} nos últimos ${WINDOW_DAYS} dias, com ${changeCount} ${changeWord}. Valor atual: ${formatSegmentValue(last)}.`;
}

const HISTORY_EXPLANATION =
  "Cada linha em degraus marca quando o valor mudou; trechos sem linha indicam períodos sem dado registrado.";

export function summarizeStoreHistory(
  storeName: string,
  rewardType: RewardType,
  lines: HistoryPresentationLine[],
): string | null {
  const values = lines.flatMap((line) =>
    line.series.sufficient
      ? line.series.segments.filter((segment) => segment.rewardType === rewardType).map((segment) => segment.value)
      : [],
  );
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const minLabel = formatHistoryValue(rewardType, min);
  const maxLabel = formatHistoryValue(rewardType, max);

  if (rewardType === "fixed") {
    const behavior = min === max ? `permaneceram em ${maxLabel}` : `variaram entre ${minLabel} e ${maxLabel}`;
    return `Nos últimos ${WINDOW_DAYS} dias, as ofertas de valor fixo de ${storeName} ${behavior} entre as plataformas acompanhadas. ${HISTORY_EXPLANATION}`;
  }

  const behavior = min === max ? `permaneceu em ${maxLabel}` : `variou entre ${minLabel} e ${maxLabel}`;
  return `Nos últimos ${WINDOW_DAYS} dias, o cashback de ${storeName} ${behavior} entre as plataformas acompanhadas. ${HISTORY_EXPLANATION}`;
}
