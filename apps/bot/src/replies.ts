import type { FloorMismatchHint, FloorRewardType, ParsedFloor } from "./floor.js";

/**
 * F4/#116 (ADR-0066) — todo texto que o bot manda vive aqui, num lugar só.
 *
 * O bloco de consentimento é a única resposta obrigatoriamente longa: precisa dizer O QUE é
 * guardado, PARA QUÊ, e COMO apagar — as três coisas que consentimento *informado* exige. As
 * outras respostas são propositalmente curtas.
 *
 * `/parar` sem argumento já funciona (apaga tudo, ver `db.ts#deleteSubscriber`) — só a fatia
 * seletiva (`/parar <slug>`) chega em #118. A mensagem não promete nada que o handler não cumpra.
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

/** "10%", "10,5%", "R$ 25", "R$ 25,50" — mesmo estilo pt-BR de `apps/scraper/src/avisos/message.ts`. */
function formatFloor(floor: ParsedFloor): string {
  const decimals = Number.isInteger(floor.value) ? 0 : 2;
  const number = floor.value.toFixed(decimals).replace(".", ",");
  return floor.rewardType === "fixed" ? `R$ ${number}` : `${number}%`;
}

const UNIT_EXAMPLE: Record<FloorRewardType, string> = {
  percent: "10 ou 10%",
  fixed: "R$ 25 ou 25 reais",
};

/**
 * Toda escrita de piso responde com o ESTADO RESULTANTE da Inscrição (modo + piso), nunca um "ok"
 * (AC #117) — inclusive quando há incompatibilidade de grandeza: o piso é gravado do mesmo jeito
 * (ADR-0063, silêncio é o pior modo de falha), e o aviso vem OPCIONAL, depois do estado.
 */
export function floorSet(storeName: string, floor: ParsedFloor, hint: FloorMismatchHint): string {
  const state = `✅ Pronto! A loja ${storeName} está em Modo acompanhamento, piso ${formatFloor(floor)} — aviso a partir daí.`;

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

/** `/piso` ajusta uma Inscrição existente — não a cria (`db.ts#setSubscriptionFloor`). */
export function notSubscribed(storeName: string): string {
  return `Você ainda não acompanha a loja ${storeName}. Use /start <loja> antes de definir um piso.`;
}
