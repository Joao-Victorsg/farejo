/**
 * F4/#117 (ADR-0063) — gramática do Piso digitada pelo Assinante e a checagem de compatibilidade
 * contra as ofertas correntes da loja. Tudo aqui é puro: nem toca banco, nem sabe de Postgres —
 * é o que faz possível testar a gramática sem subir o Supabase local.
 *
 * A gramática é estrita e escolhida pelo projeto, não herdada dos sites: `10`/`10%` viram piso
 * percentual, `R$ 25`/`25 reais` viram piso em reais. Número puro cai em percentual porque ofertas
 * percentuais são a esmagadora maioria do catálogo (fixo é ~3,5%, concentrado em apostas, educação
 * e antivírus) — perguntar a unidade para todo mundo custaria mais do que vale para esse punhado.
 */
export type FloorRewardType = "percent" | "fixed";

export interface ParsedFloor {
  rewardType: FloorRewardType;
  value: number;
}

function brNumber(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."));
}

const NUM = "(\\d+(?:[.,]\\d+)?)";
const FIXED_PREFIXED_RE = new RegExp(`^r\\$\\s*${NUM}$`, "i");
const FIXED_SUFFIXED_RE = new RegExp(`^${NUM}\\s*reais$`, "i");
const PERCENT_RE = new RegExp(`^${NUM}\\s*%$`);
const BARE_RE = new RegExp(`^${NUM}$`);

function toParsedFloor(rewardType: FloorRewardType, raw: string): ParsedFloor | null {
  const value = brNumber(raw);
  // `floor_value > 0` é invariante de schema (`subscriptions_floor_value_positive`, #113).
  // Validar aqui — não só deixar o Postgres rejeitar — é o que permite responder "de forma útil"
  // em vez de vazar um erro de constraint pro Assinante.
  return Number.isFinite(value) && value > 0 ? { rewardType, value } : null;
}

/**
 * `null` cobre tanto grandeza não reconhecida quanto valor fora do domínio. As quatro formas do
 * AC, nesta ordem de tentativa: `R$ 25` / `25 reais` (fixo) antes de `10%` / `10` (percentual) —
 * a ordem não importa para o resultado (os prefixos/sufixos são mutuamente exclusivos), só reflete
 * a leitura do AC.
 */
export function parseFloorValue(text: string): ParsedFloor | null {
  const trimmed = text.trim();

  const fixedMatch = FIXED_PREFIXED_RE.exec(trimmed) ?? FIXED_SUFFIXED_RE.exec(trimmed);
  if (fixedMatch) return toParsedFloor("fixed", fixedMatch[1]!);

  const percentMatch = PERCENT_RE.exec(trimmed) ?? BARE_RE.exec(trimmed);
  if (percentMatch) return toParsedFloor("percent", percentMatch[1]!);

  return null;
}

export interface ParsedPisoArgument {
  slug: string;
  valueText: string;
}

/**
 * Separa `/piso <loja> <valor...>`. O comando nomeia a loja em vez de abrir diálogo em etapas
 * (issue #117) — e como "R$ 25" e "25 reais" ocupam dois tokens, o slug é sempre o PRIMEIRO token
 * e o resto (inteiro) é o valor, nunca um split fixo por posição.
 *
 * `null` quando falta loja ou falta valor — as duas situações em que não há o que tentar parsear,
 * então viram a mesma resposta de uso (`replies.ts#invalidFloorValue`).
 */
export function splitPisoArgument(argument: string | undefined): ParsedPisoArgument | null {
  if (!argument) return null;
  const [slug, ...rest] = argument.trim().split(/\s+/);
  if (!slug || rest.length === 0) return null;
  return { slug, valueText: rest.join(" ") };
}

export type FloorMismatchHint =
  | { kind: "match" }
  | { kind: "no-eligible-offers" }
  | { kind: "mismatch"; suggestedType: FloorRewardType };

/**
 * Compara a grandeza do Piso escolhido contra as grandezas com ao menos uma Oferta pública
 * elegível da loja (#117). Só existem duas grandezas no domínio (`percent`/`fixed`) — por isso
 * "não casa com nada, mas existe oferta elegível" só pode significar que TODA oferta elegível é
 * da grandeza complementar, e a sugestão sai sem ambiguidade, sem precisar inspecionar o conjunto.
 */
export function floorMismatchHint(rewardType: FloorRewardType, eligibleTypes: ReadonlySet<FloorRewardType>): FloorMismatchHint {
  if (eligibleTypes.has(rewardType)) return { kind: "match" };
  if (eligibleTypes.size === 0) return { kind: "no-eligible-offers" };
  return { kind: "mismatch", suggestedType: rewardType === "percent" ? "fixed" : "percent" };
}
