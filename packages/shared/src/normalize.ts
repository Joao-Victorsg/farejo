import { stripAccents } from "./text.js";

/**
 * L2: chave de normalização de nome de loja (= `stores.slug`).
 * minúsculas → sem acento → `+`→"plus", `&`→"e" → tira domínio → tira pontuação → junta tokens.
 * `+` vira "plus" ANTES de matar pontuação, senão "Disney+" colide com "Disney".
 *
 * Não remove palavras de ruído (`loja`/`store`/`br`/`oficial`): "Shop" é marca em
 * "Fast Shop", enfeite em "Nike Store" — removê-las funde lojas diferentes. Mantém
 * "Nike"≠"Nike Store" e "Disney+"≠"Disney Store" de propósito; esses pares vão para
 * uma tabela de alias curada, não para esta chave.
 */
export function l2Key(name: string): string {
  let t = stripAccents(name.toLowerCase());
  t = t.replace(/\+/g, " plus ");
  t = t.replace(/&/g, " e ");
  t = t.replace(/\.com\.br\b|\.com\b|\.br\b/g, " ");
  t = t.replace(/[^a-z0-9]+/g, " ");
  return t.trim().split(/\s+/).filter(Boolean).join("");
}
