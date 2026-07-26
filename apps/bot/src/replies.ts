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
