/**
 * Janela servida pelo contrato de leitura (ADR-0010). O leitor escolhe recortes DENTRO dela;
 * nada aqui amplia o que `web_read.store_history` entrega.
 */
const SERVED_DAYS = 60;
export const HISTORY_WINDOW_MS = SERVED_DAYS * 24 * 60 * 60 * 1000;

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

/** Quanto de histórico esta loja tem de fato, já limitado ao que o contrato de leitura serve. */
export interface HistoryAvailability {
  /** Primeiro instante com dado desenhável. `null` quando nenhuma série é suficiente. */
  from: Date | null;
  /** Dias inteiros disponíveis — arredondado para baixo, para nunca prometer um dia que não fechou. */
  days: number;
  /**
   * A série alcança o início da janela servida: existe histórico anterior que não recebemos.
   * Enquanto isso for verdade, "Tudo" seria mentira e a régua para no teto servido.
   */
  atServedCeiling: boolean;
}

/** Um degrau da régua de período. `id` é o que viaja em `?periodo=`. */
export interface HistoryRangeOption {
  id: string;
  days: number;
  label: string;
  /** Cobre todo o histórico disponível, e não um recorte dele. */
  isFullAvailable: boolean;
}

export interface HistoryWindow {
  start: Date;
  end: Date;
  days: number;
  isFullAvailable: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const HISTORY_RANGE_LADDER_DAYS = [7, 30, 60] as const;
/** Um degrau só entra na régua se encurtar a janela seguinte em pelo menos um quarto — senão é escolha falsa. */
const RANGE_STEP_RATIO = 0.75;
/** Folga à esquerda quando a janela é ajustada ao dado, para o primeiro degrau não colar na borda. */
const WINDOW_PADDING_RATIO = 0.08;
/**
 * Largura de plotagem de referência no desktop, medida em 1440 px. É fixa de propósito: um padrão
 * derivado de `window.innerWidth` divergiria entre servidor e cliente e pularia no primeiro paint.
 */
const REFERENCE_PLOT_WIDTH_PX = 712;
/** Piso de legibilidade entre degraus consecutivos: ~3 diâmetros do marcador de mudança. */
const MIN_CHANGE_SPACING_PX = 24;
/** Um tick interior colado no fim duplicaria o rótulo da borda; some quando chega perto demais. */
const MIN_END_TICK_GAP_RATIO = 0.06;

function valueAt(segments: HistorySegment[], at: number, windowEnd: number): number | null {
  for (const segment of segments) {
    const from = new Date(segment.from).getTime();
    const to = new Date(segment.to).getTime();
    if (from <= at && (at < to || (at === windowEnd && to === windowEnd))) return segment.value;
  }
  return null;
}

const TICK_INTERVALS_MS = [DAY_MS, 2 * DAY_MS, WEEK_MS, 2 * WEEK_MS, 4 * WEEK_MS];

/**
 * Ticks alinhados ao intervalo, escolhidos pelo VÃO da janela e não pela janela servida: uma
 * janela de 8 dias precisa de marcas diárias, uma de 60 precisa de semanais. Ambas as bordas
 * entram sempre; um tick interior que caia colado na borda direita é descartado para não
 * repetir a mesma data duas vezes.
 */
export function buildResponsiveHistoryTicks(windowStart: Date, windowEnd: Date, viewportWidth: number): number[] {
  const start = windowStart.getTime();
  const end = windowEnd.getTime();
  if (end <= start) return [start];

  const span = end - start;
  const targetCount = viewportWidth < 640 ? 4 : viewportWidth < 1024 ? 6 : 10;
  const interval = TICK_INTERVALS_MS.find((candidate) => span / candidate <= targetCount) ?? TICK_INTERVALS_MS.at(-1)!;

  const ticks = [start];
  for (let at = start + interval; at < end - span * MIN_END_TICK_GAP_RATIO; at += interval) ticks.push(at);
  ticks.push(end);
  return ticks;
}

/**
 * Deriva o alcance real do histórico das séries já compostas. Só séries suficientes contam:
 * uma plataforma ainda "coletando" não deve esticar o eixo de quem já tem o que mostrar.
 */
export function describeHistoryAvailability(
  lines: HistoryPresentationLine[],
  servedStart: Date,
  now: Date,
): HistoryAvailability {
  const starts = lines
    .filter((line) => line.series.sufficient)
    .flatMap((line) => line.series.segments.map((segment) => new Date(segment.from).getTime()));
  if (starts.length === 0) return { from: null, days: 0, atServedCeiling: false };

  const earliest = Math.min(...starts);
  return {
    from: new Date(earliest),
    days: Math.max(1, Math.floor((now.getTime() - earliest) / DAY_MS)),
    atServedCeiling: earliest <= servedStart.getTime(),
  };
}

/**
 * Monta a régua a partir do que existe, nunca de uma lista fixa: um degrau maior que o dado
 * reproduziria exatamente o eixo vazio que a janela adaptativa resolve. Quando a série encosta
 * no teto servido, o último degrau é o próprio teto e NÃO se chama "Tudo" — 60 dias não é tudo
 * o que a loja viveu, é tudo o que nós lemos.
 */
export function buildHistoryRangeOptions(availability: HistoryAvailability): HistoryRangeOption[] {
  if (availability.from === null) return [];

  const ceiling = availability.atServedCeiling ? SERVED_DAYS : availability.days;
  const options: HistoryRangeOption[] = HISTORY_RANGE_LADDER_DAYS
    .filter((days) => days < ceiling * RANGE_STEP_RATIO)
    .map((days) => ({ id: String(days), days, label: `${days} dias`, isFullAvailable: false }));

  options.push(
    availability.atServedCeiling
      ? { id: String(SERVED_DAYS), days: SERVED_DAYS, label: `${SERVED_DAYS} dias`, isFullAvailable: false }
      : { id: "tudo", days: availability.days, label: `Tudo · ${availability.days} dias`, isFullAvailable: true },
  );

  return options;
}

export function resolveHistoryWindow(
  option: HistoryRangeOption,
  availability: HistoryAvailability,
  now: Date,
): HistoryWindow {
  if (option.isFullAvailable && availability.from !== null) {
    const span = now.getTime() - availability.from.getTime();
    return {
      start: new Date(availability.from.getTime() - span * WINDOW_PADDING_RATIO),
      end: now,
      days: option.days,
      isFullAvailable: true,
    };
  }

  return { start: new Date(now.getTime() - option.days * DAY_MS), end: now, days: option.days, isFullAvailable: false };
}

function countChangesAfter(lines: HistoryPresentationLine[], startMs: number): number {
  return lines
    .filter((line) => line.series.sufficient)
    .reduce(
      (total, line) => total + line.series.segments.filter((segment) => new Date(segment.from).getTime() > startMs).length,
      0,
    );
}

/**
 * Escolhe o padrão pela DENSIDADE de mudanças, não pelo volume de dias: duas lojas com o mesmo
 * tempo de vida pedem janelas diferentes se uma muda três vezes por dia e a outra uma vez por mês.
 * Conta as mudanças das duas grandezas juntas — errar para o lado de aproximar é mais barato que
 * entregar um amontoado ilegível.
 */
export function pickDefaultHistoryRange(
  options: HistoryRangeOption[],
  lines: HistoryPresentationLine[],
  availability: HistoryAvailability,
  now: Date,
): HistoryRangeOption | null {
  if (options.length === 0) return null;

  for (let index = options.length - 1; index >= 0; index -= 1) {
    const option = options[index]!;
    const changes = countChangesAfter(lines, resolveHistoryWindow(option, availability, now).start.getTime());
    if (changes === 0 || REFERENCE_PLOT_WIDTH_PX / changes >= MIN_CHANGE_SPACING_PX) return option;
  }

  return options[0]!;
}

export function findHistoryRangeOption(options: HistoryRangeOption[], id: string | null): HistoryRangeOption | null {
  return options.find((option) => option.id === id) ?? null;
}

/**
 * Recorta uma série já composta na janela escolhida pelo leitor. `sufficient` é PRESERVADO de
 * propósito: a loja tem mudanças observadas, e um recorte onde nada mudou continua sendo
 * histórico verdadeiro — linha reta ancorada, não "Histórico sendo construído".
 */
export function clipSeriesToWindow(series: ComposedSeries, windowStart: Date, windowEnd: Date): ComposedSeries {
  const start = windowStart.getTime();
  const end = windowEnd.getTime();
  const segments: HistorySegment[] = [];

  for (const segment of series.segments) {
    const from = new Date(segment.from).getTime();
    const to = new Date(segment.to).getTime();
    if (to <= start || from >= end) continue;
    segments.push({
      rewardType: segment.rewardType,
      from: from < start ? windowStart.toISOString() : segment.from,
      to: to > end ? windowEnd.toISOString() : segment.to,
      value: segment.value,
    });
  }

  return { sufficient: series.sufficient, segments };
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
/**
 * "Todo o histórico disponível" e "os últimos N dias" são fatos diferentes e o texto precisa
 * distingui-los: o primeiro admite que a loja é nova, o segundo afirma um recorte escolhido.
 */
function describeWindow(window: HistoryWindow): string {
  return window.isFullAvailable
    ? `nos ${window.days} dias de histórico disponíveis`
    : `nos últimos ${window.days} dias`;
}

function capitalize(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

export function summarizeSeries(platformName: string, series: ComposedSeries, window: HistoryWindow): string {
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
    return `${platformName}: manteve ${formatSegmentValue(last)} ${describeWindow(window)}.`;
  }

  const changeWord = changeCount === 1 ? "mudança" : "mudanças";
  return `${platformName}: variou entre ${formatSegmentValue(minSegment)} e ${formatSegmentValue(maxSegment)} ${describeWindow(window)}, com ${changeCount} ${changeWord}. Valor atual: ${formatSegmentValue(last)}.`;
}

const HISTORY_EXPLANATION =
  "Cada linha em degraus marca quando o valor mudou; trechos sem linha indicam períodos sem dado registrado.";

export function summarizeStoreHistory(
  storeName: string,
  rewardType: RewardType,
  lines: HistoryPresentationLine[],
  window: HistoryWindow,
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

  const period = capitalize(describeWindow(window));

  if (rewardType === "fixed") {
    const behavior = min === max ? `permaneceram em ${maxLabel}` : `variaram entre ${minLabel} e ${maxLabel}`;
    return `${period}, as ofertas de valor fixo de ${storeName} ${behavior} entre as plataformas acompanhadas. ${HISTORY_EXPLANATION}`;
  }

  const behavior = min === max ? `permaneceu em ${maxLabel}` : `variou entre ${minLabel} e ${maxLabel}`;
  return `${period}, o cashback de ${storeName} ${behavior} entre as plataformas acompanhadas. ${HISTORY_EXPLANATION}`;
}
