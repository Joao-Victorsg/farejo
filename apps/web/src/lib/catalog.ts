import "server-only";
import { unstable_cache } from "next/cache";
import { Pool } from "pg";
import { z } from "zod";
import { CATALOG_CACHE_TAG, CATALOG_CACHE_TTL_SECONDS } from "./catalog-cache";
import { catalogHref, isCatalogSort, type CatalogRequest, type CatalogSort } from "./catalog-url";

export { catalogHref, type CatalogRequest, type CatalogSort } from "./catalog-url";

export const CATALOG_PAGE_SIZE = 24;

export type ParsedCatalogRequest = CatalogRequest & {
  invalidParameters: boolean;
  invalidPage: boolean;
  needsCanonicalRedirect: boolean;
};

const CatalogSearchRow = z.object({
  slug: z.string(),
  name: z.string(),
  logo_url: z.string().url().nullable(),
  platform_count: z.number().int().positive(),
  relevance: z.number().int().min(0).max(4),
  total_count: z.number().int().nonnegative(),
});

const CatalogOfferRow = z.object({
  store_slug: z.string(),
  platform_id: z.string(),
  platform_name: z.string(),
  reward_type: z.enum(["percent", "fixed"]),
  value: z.number().nonnegative(),
  value_partial: z.number().nonnegative().nullable(),
  is_upto: z.boolean(),
  freshness: z.enum(["fresh", "delayed"]),
});

const CatalogSearchParams = z.object({
  page: z.union([z.string(), z.array(z.string())]).optional(),
  q: z.union([z.string(), z.array(z.string())]).optional(),
  sort: z.union([z.string(), z.array(z.string())]).optional(),
});

type CatalogOfferBase = {
  platformId: string;
  platformName: string;
  freshness: "fresh" | "delayed";
};

export type CatalogOffer = CatalogOfferBase & (
  | {
      reward: { type: "percent"; value: number; valuePartial: number | null; isUpto: boolean };
    }
  | {
      reward: { type: "fixed"; value: number; currency: "BRL" };
    }
);

export type CatalogStore = {
  slug: string;
  name: string;
  logoUrl: string | null;
  platformCount: number;
  offers: CatalogOffer[];
};

export type CatalogPage = {
  items: CatalogStore[];
  page: number;
  query: string;
  sort: CatalogSort;
  total: number;
  totalPages: number;
};

let pool: Pool | undefined;

function getPool() {
  if (pool) return pool;

  const connectionString = process.env.FAREJO_WEB_DATABASE_URL;
  if (!connectionString) throw new Error("FAREJO_WEB_DATABASE_URL is not configured");

  pool = new Pool({ connectionString, max: 1 });
  return pool;
}

function getSingleParameter(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export function parseCatalogRequest(searchParams: { page?: string | string[]; q?: string | string[]; sort?: string | string[] }): ParsedCatalogRequest {
  const parsedParams = CatalogSearchParams.parse(searchParams);
  const invalidParameters = Array.isArray(parsedParams.q) || Array.isArray(parsedParams.sort);
  const rawPage = getSingleParameter(parsedParams.page);
  const rawQuery = getSingleParameter(parsedParams.q);
  const rawSort = getSingleParameter(parsedParams.sort);
  const query = rawQuery?.trim().slice(0, 100) ?? "";
  const parsedPage = rawPage === undefined ? 1 : Number(rawPage);
  const invalidPage = Array.isArray(parsedParams.page) || (rawPage !== undefined && (!Number.isSafeInteger(parsedPage) || parsedPage < 1));
  const page = invalidPage ? 1 : parsedPage;
  const sort = rawSort !== undefined && isCatalogSort(rawSort) ? rawSort : "platforms";
  const needsCanonicalRedirect = !invalidPage && (
    rawPage === "1"
    || (rawPage !== undefined && rawPage !== String(page))
    || (rawQuery !== undefined && rawQuery !== query)
    || rawSort === "platforms"
    || (rawSort !== undefined && !isCatalogSort(rawSort))
  );

  return { page, query, sort, invalidParameters, invalidPage, needsCanonicalRedirect };
}

function assertRequest(request: CatalogRequest) {
  if (!Number.isSafeInteger(request.page) || request.page < 1) throw new Error("Invalid catalog page");
  if (!isCatalogSort(request.sort)) throw new Error("Invalid catalog sort");
  if (request.query.length > 100) throw new Error("Catalog query is too long");
}

async function getCatalogPageUncached(request: CatalogRequest): Promise<CatalogPage> {
  const database = getPool();
  const search = (page: number) => database.query(
    "select slug, name, logo_url, platform_count, relevance, total_count from web_read.catalog_search($1, $2, $3)",
    [request.query, request.sort, page],
  );
  const pageResult = await search(request.page);
  const rows = z.array(CatalogSearchRow).parse(pageResult.rows);
  const total = rows[0]?.total_count ?? (request.page > 1 ? z.array(CatalogSearchRow).parse((await search(1)).rows)[0]?.total_count ?? 0 : 0);
  const slugs = rows.map((row) => row.slug);
  const offersResult = slugs.length === 0
    ? { rows: [] }
    : await database.query(
      `select store_slug, platform_id, platform_name, reward_type, value, value_partial, is_upto, freshness
       from web_read.catalog_offers
       where store_slug = any($1::text[])
       order by store_slug asc, platform_name asc, platform_id asc`,
      [slugs],
    );
  const offers = z.array(CatalogOfferRow).parse(offersResult.rows);
  const offersByStore = new Map<string, CatalogOffer[]>();

  for (const offer of offers) {
    const storeOffers = offersByStore.get(offer.store_slug) ?? [];
    const offerBase = { platformId: offer.platform_id, platformName: offer.platform_name, freshness: offer.freshness };
    const publicOffer = offer.reward_type === "percent"
      ? { ...offerBase, reward: { type: "percent" as const, value: offer.value, valuePartial: offer.value_partial, isUpto: offer.is_upto } }
      : { ...offerBase, reward: { type: "fixed" as const, value: offer.value, currency: "BRL" as const } };
    storeOffers.push(publicOffer);
    offersByStore.set(offer.store_slug, storeOffers);
  }

  return {
    items: rows.map((store) => ({
      slug: store.slug,
      name: store.name,
      logoUrl: store.logo_url,
      platformCount: store.platform_count,
      offers: offersByStore.get(store.slug) ?? [],
    })),
    page: request.page,
    query: request.query,
    sort: request.sort,
    total,
    totalPages: Math.ceil(total / CATALOG_PAGE_SIZE),
  };
}

const getCachedCatalogPage = unstable_cache(getCatalogPageUncached, ["catalog-page-v2"], {
  tags: [CATALOG_CACHE_TAG],
  revalidate: CATALOG_CACHE_TTL_SECONDS,
});

export async function getCatalogPage(request: CatalogRequest): Promise<CatalogPage> {
  assertRequest(request);
  return getCachedCatalogPage(request);
}
