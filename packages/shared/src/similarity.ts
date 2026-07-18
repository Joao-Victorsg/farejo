/** Levenshtein sem dependência (docs/poc/src/normalize.ts): pega plural/typo que a chave exata perde. */
export function levenshteinDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** 1 = idênticas, 0 = nenhum caractere em comum na posição do maior comprimento. */
export function levenshteinRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  return 1 - levenshteinDistance(a, b) / Math.max(a.length, b.length);
}
