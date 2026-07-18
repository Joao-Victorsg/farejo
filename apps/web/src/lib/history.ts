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

const INSUFFICIENT_SIGNALS: OfferSignals = { isBoost: false, typicalValue: null, previousValue: null, validUntil: null };

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
  if (totalActiveMs < BOOST_MIN_ACTIVE_MS) return INSUFFICIENT_SIGNALS;

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
  return segment.rewardType === "percent"
    ? `${segment.value.toLocaleString("pt-BR")}%`
    : segment.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
