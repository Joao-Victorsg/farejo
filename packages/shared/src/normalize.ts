import { stripAccents } from "./text.js";

/**
 * L1: minúsculas → sem acento → `+`→"plus", `&`→"e" → tira domínio → tira pontuação →
 * tokens separados por espaço. `+` vira "plus" ANTES de matar pontuação, senão
 * "Disney+" colide com "Disney".
 */
function l1Tokens(name: string): string[] {
  let t = stripAccents(name.toLowerCase());
  t = t.replace(/\+/g, " plus ");
  t = t.replace(/&/g, " e ");
  t = t.replace(/\.com\.br\b|\.com\b|\.br\b/g, " ");
  t = t.replace(/[^a-z0-9]+/g, " ");
  return t.trim().split(/\s+/).filter(Boolean);
}

/**
 * L2: chave de normalização de nome de loja (= `stores.slug`). L1 + junta os tokens.
 *
 * Não remove palavras de ruído (`loja`/`store`/`br`/`oficial`): "Shop" é marca em
 * "Fast Shop", enfeite em "Nike Store" — removê-las funde lojas diferentes. Mantém
 * "Nike"≠"Nike Store" e "Disney+"≠"Disney Store" de propósito; esses pares vão para
 * uma tabela de alias curada, não para esta chave.
 */
export function l2Key(name: string): string {
  return l1Tokens(name).join("");
}

/** Decoradores. Tentador remover da L2 — e errado: "Shop" é marca em "Fast Shop", enfeite em "Nike Store". */
const DECORATORS = new Set(["loja", "lojas", "store", "shop", "oficial", "online", "brasil", "br"]);

/**
 * L3 (docs/poc/src/normalize.ts, 09/07/2026): L1 sem tokens decoradores, depois junta.
 * NUNCA é chave de identidade (ADR-0006) — só gerador de candidato para revisão humana:
 * "Nike" e "Nike Store" têm a mesma L3 mas são lojas distintas na maioria dos casos.
 */
export function l3Key(name: string): string {
  const tokens = l1Tokens(name);
  const kept = tokens.filter((t) => !DECORATORS.has(t));
  return (kept.length > 0 ? kept : tokens).join("");
}
