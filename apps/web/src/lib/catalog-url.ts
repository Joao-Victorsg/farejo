export const CATALOG_SORTS = ["platforms", "cashback", "az"] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number];

export type CatalogRequest = {
  page: number;
  query: string;
  sort: CatalogSort;
};

export function isCatalogSort(value: string): value is CatalogSort {
  return value === "platforms" || value === "cashback" || value === "az";
}

export function catalogHref({ page, query, sort }: CatalogRequest) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (sort !== "platforms") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/?${suffix}` : "/";
}
