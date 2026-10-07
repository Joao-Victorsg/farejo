export type SearchResultBucket = "0" | "1" | "2-5" | "6+";

export function searchResultBucket(resultCount: number): SearchResultBucket {
  if (!Number.isSafeInteger(resultCount) || resultCount < 0) throw new Error("Contagem de resultados inválida");
  if (resultCount === 0) return "0";
  if (resultCount === 1) return "1";
  if (resultCount <= 5) return "2-5";
  return "6+";
}

export function searchResultsEventParams(location: URL, resultCount: number) {
  return {
    result_count_bucket: searchResultBucket(resultCount),
    page_location: `${location.origin}${location.pathname}`,
  };
}
