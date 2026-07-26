import type { RewardType, Subscription } from "./db.js";
import type { FloorMismatchHint, ParsedFloor } from "./floor.js";

/**
 * F4/#116-#118 (ADR-0066) — todo texto que o bot manda vive aqui, num lugar só.
 *
 * O bloco de consentimento é a única resposta obrigatoriamente longa: precisa dizer O QUE é
 * guardado, PARA QUÊ, e COMO apagar — as três coisas que consentimento *informado* exige. As
 * outras respostas são propositalmente curtas.
 *
 * Toda escrita responde com o estado resultante (ADR-0065), nunca um "ok" solto: `stoppedStore`
 * nomeia a loja, `subscriptionCapped` explica o teto, `subscriptionsList` mostra o que existe.
 */

export function consentBlock(siteUrl: string): string {
  return [
    "👋 Olá! Sou o bot de avisos do farejô.",
    "",
    "Guardamos só o identificador da sua conversa aqui no Telegram e as lojas que você escolher acompanhar, para te avisar quando o cashback delas melhorar — nada de nome, @ ou histórico de mensagens.",
    "",
    `Apague tudo a qualquer momento com /parar. Política completa: ${siteUrl}/privacidade`,
  ].join("\n");
}

/** Mesma frase exista ou não Assinante para este chat — verdadeira nos dois casos. */
export function stopped(): string {
  return "✅ Pronto! Não vou mais te avisar, e não guardo mais nada seu.";
}

export function confirmSubscription(storeName: string): string {
  return `✅ Pronto! Vou te avisar quando o cashback da ${storeName} melhorar.`;
}

export function welcome(siteUrl: string): string {
  return [
    "Eu aviso quando o cashback de uma loja melhorar.",
    "",
    `Use /start <loja> para acompanhar uma loja, ou veja o catálogo completo em ${siteUrl}`,
  ].join("\n");
}

export function storeNotFound(siteUrl: string): string {
  return `Não encontrei essa loja. Veja o catálogo completo em ${siteUrl}`;
}

export function privacy(siteUrl: string): string {
  return `Guardamos só a sua identificação no Telegram e as lojas escolhidas, para te avisar quando o cashback melhorar. Política completa: ${siteUrl}/privacidade`;
}

export function fallback(siteUrl: string): string {
  return `Não entendi. Use /start <loja> para acompanhar uma loja — veja o catálogo em ${siteUrl}`;
}

export function stoppedStore(storeName: string): string {
  return `✅ Pronto! Não vou mais te avisar sobre a ${storeName}.`;
}

/** `/parar <slug>` numa loja que a pessoa nunca assinou (ou já tinha parado) — não é erro. */
export function notSubscribed(storeName: string): string {
  return `Você não tem uma Inscrição na ${storeName}.`;
}

/** `/piso` ajusta uma Inscrição existente — não a cria (`db.ts#setSubscriptionFloor`). Mensagem própria porque a orientação (usar `/start`) é específica desse comando, diferente do `notSubscribed` genérico do `/parar <slug>`. */
export function notSubscribedForFloor(storeName: string): string {
  return `Você ainda não acompanha a loja ${storeName}. Use /start <loja> antes de definir um piso.`;
}

export function subscriptionCapped(storeName: string): string {
  return `Você já tem 10 lojas na sua lista, o teto por Assinante. Remova uma com /parar <slug> antes de adicionar ${storeName}.`;
}

/**
 * "5%", "4,50%", "R$ 15", "R$ 15,50" — mesma formatação pt-BR do texto do Aviso (`avisos/message.ts`).
 * Único helper para as duas grandezas do domínio: `/lojas` (via `Subscription.modeInfo`, #118) e
 * `/piso` (via `ParsedFloor`, #117) formatam o mesmo par (valor, grandeza), só a origem difere.
 */
function formatFloor(value: number, rewardType: RewardType): string {
  const decimals = Number.isInteger(value) ? 0 : 2;
  const number = value.toFixed(decimals).replace(".", ",");
  return rewardType === "fixed" ? `R$ ${number}` : `${number}%`;
}

function formatSubscriptionLine(item: Subscription): string {
  const mode =
    item.modeInfo.mode === "improvement"
      ? "melhoria"
      : `acompanhamento, piso ${formatFloor(item.modeInfo.floorValue, item.modeInfo.floorRewardType)}`;
  return `• ${item.storeName} (${item.slug}) — Modo ${mode}`;
}

export function subscriptionsList(items: readonly Subscription[], siteUrl: string): string {
  if (items.length === 0) {
    return `Você ainda não tem nenhuma Inscrição. Use /start <loja> para acompanhar uma — veja o catálogo em ${siteUrl}`;
  }
  return ["Suas Inscrições:", "", ...items.map(formatSubscriptionLine)].join("\n");
}

export function help(): string {
  return [
    "Comandos disponíveis:",
    "/start <loja> — acompanhar uma loja",
    "/piso <loja> <valor> — definir um piso e acompanhar a partir dele",
    "/lojas — ver suas Inscrições",
    "/parar <loja> — remover uma Inscrição",
    "/parar — remover tudo e apagar sua conta",
    "/privacidade — o que guardamos e como apagar",
    "/ajuda — esta mensagem",
  ].join("\n");
}

const UNIT_EXAMPLE: Record<RewardType, string> = {
  percent: "10 ou 10%",
  fixed: "R$ 25 ou 25 reais",
};

/**
 * Toda escrita de piso responde com o ESTADO RESULTANTE da Inscrição (modo + piso), nunca um "ok"
 * (AC #117) — inclusive quando há incompatibilidade de grandeza: o piso é gravado do mesmo jeito
 * (ADR-0063, silêncio é o pior modo de falha), e o aviso vem OPCIONAL, depois do estado.
 */
export function floorSet(storeName: string, floor: ParsedFloor, hint: FloorMismatchHint): string {
  const state = `✅ Pronto! A loja ${storeName} está em Modo acompanhamento, piso ${formatFloor(floor.value, floor.rewardType)} — aviso a partir daí.`;

  if (hint.kind === "match") return state;
  if (hint.kind === "no-eligible-offers") {
    return `${state}\n\n⚠️ Não encontrei oferta elegível dessa loja agora para conferir — o piso fica valendo, é só não ter como confirmar que ele bate com alguma oferta corrente.`;
  }
  const suggestedUnit = hint.suggestedType === "fixed" ? "R$" : "%";
  return `${state}\n\n⚠️ Hoje a loja ${storeName} só tem oferta elegível em ${suggestedUnit}. Se era isso que você queria, tente de novo com ${UNIT_EXAMPLE[hint.suggestedType]}.`;
}

export function invalidFloorValue(): string {
  return [
    "Não entendi esse piso. Formas aceitas:",
    "/piso <loja> 10 ou /piso <loja> 10% — piso percentual",
    "/piso <loja> R$ 25 ou /piso <loja> 25 reais — piso em reais",
  ].join("\n");
}
