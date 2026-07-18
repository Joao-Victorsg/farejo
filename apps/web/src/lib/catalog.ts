import "server-only";
import { unstable_cache } from "next/cache";
import { Pool } from "pg";
import { z } from "zod";
import { CATALOG_CACHE_TAG, CATALOG_CACHE_TTL_SECONDS } from "./catalog-cache";
import { catalogHref, isCatalogSort, type CatalogRequest, type CatalogSort } from "./catalog-url";
import { composeStoreHistory, deriveOfferSignals, type OfferSignals, type StoreHistoryRow, type StoreHistorySeries } from "./history";

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
  last_seen_at: z.coerce.date(),
  previous_reward_type: z.enum(["percent", "fixed"]).nullable(),
  previous_value: z.number().nonnegative().nullable(),
});

const CatalogHistoryDbRow = z.object({
  store_slug: z.string(),
  platform_id: z.string(),
  platform_name: z.string(),
  reward_type: z.enum(["percent", "fixed"]),
  value: z.number().nullable(),
  value_partial: z.number().nullable(),
  changed_at: z.coerce.date(),
});

const StoreDetailRow = z.object({
  slug: z.string(),
  name: z.string(),
  logo_url: z.string().url().nullable(),
  platform_count: z.number().int().nonnegative(),
});

const StoreSlugRow = z.object({ slug: z.string() });

const StoreHistoryDbRow = z.object({
  platform_id: z.string(),
  platform_name: z.string(),
  reward_type: z.enum(["percent", "fixed"]),
  value: z.number().nullable(),
  value_partial: z.number().nullable(),
  changed_at: z.coerce.date(),
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
  lastSeenAt: string;
};

export type CatalogOffer = CatalogOfferBase & (
  | {
      reward: { type: "percent"; value: number; valuePartial: number | null; isUpto: boolean; partial: OfferSignals | null } & OfferSignals;
    }
  | {
      reward: { type: "fixed"; value: number; currency: "BRL" } & OfferSignals;
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

export type StoreDetail = CatalogStore & { history: StoreHistoryRow[] };

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
  const [offersResult, historyResult] = await Promise.all([
    slugs.length === 0
      ? Promise.resolve({ rows: [] })
      : database.query(
        `select store_slug, platform_id, platform_name, reward_type, value, value_partial, is_upto, freshness, last_seen_at,
                previous_reward_type, previous_value
         from web_read.catalog_offers
         where store_slug = any($1::text[])
         order by store_slug asc, platform_name asc, platform_id asc`,
        [slugs],
      ),
    slugs.length === 0
      ? Promise.resolve({ rows: [] })
      : database.query(
        `select store_slug, platform_id, platform_name, reward_type, value, value_partial, changed_at
         from web_read.catalog_history($1::text[])`,
        [slugs],
      ),
  ]);
  const offers = z.array(CatalogOfferRow).parse(offersResult.rows);
  const seriesIndex = buildSeriesIndex(z.array(CatalogHistoryDbRow).parse(historyResult.rows), new Date());
  const offersByStore = mapCatalogOffers(offers, seriesIndex);

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

const EMPTY_SERIES: StoreHistorySeries["primary"] = { sufficient: false, segments: [] };

/**
 * Agrupa linhas cruas de `catalog_history`/`store_history` por loja e recompõe a série de cada
 * plataforma (ADR-0010/ADR-0011), indexando por `"${storeSlug}:${platformId}"` — chave que
 * `mapCatalogOffers` usa para casar cada oferta com sua própria baseline de boost (F3/T9/#55).
 */
function buildSeriesIndex(rows: z.infer<typeof CatalogHistoryDbRow>[], now: Date): Map<string, StoreHistorySeries> {
  const rowsByStore = new Map<string, StoreHistoryRow[]>();
  for (const row of rows) {
    const list = rowsByStore.get(row.store_slug) ?? [];
    list.push({
      platformId: row.platform_id,
      platformName: row.platform_name,
      rewardType: row.reward_type,
      value: row.value,
      valuePartial: row.value_partial,
      changedAt: row.changed_at.toISOString(),
    });
    rowsByStore.set(row.store_slug, list);
  }

  const index = new Map<string, StoreHistorySeries>();
  for (const [storeSlug, storeRows] of rowsByStore) {
    for (const series of composeStoreHistory(storeRows, now)) {
      index.set(`${storeSlug}:${series.platformId}`, series);
    }
  }
  return index;
}

/**
 * Boost/valor típico/valor anterior (ADR-0012/ADR-0013) são derivados aqui, nunca persistidos:
 * cada oferta busca sua série já composta em `seriesIndex` e reaplica `deriveOfferSignals` — a
 * mesma função usada pelo gráfico de histórico, para as duas superfícies nunca divergirem.
 */
function mapCatalogOffers(offers: z.infer<typeof CatalogOfferRow>[], seriesIndex: Map<string, StoreHistorySeries>) {
  const offersByStore = new Map<string, CatalogOffer[]>();

  for (const offer of offers) {
    const series = seriesIndex.get(`${offer.store_slug}:${offer.platform_id}`);
    const nativePrevious = offer.previous_reward_type !== null && offer.previous_value !== null
      ? { rewardType: offer.previous_reward_type, value: offer.previous_value }
      : null;

    const primarySignals = deriveOfferSignals(series?.primary ?? EMPTY_SERIES, { rewardType: offer.reward_type, value: offer.value }, nativePrevious);
    // Sem sinal nativo de "valor anterior" para a taxa não-correntista do Inter (docs/poc):
    // a modalidade parcial só tem o fallback histórico (ADR-0013 regra 2).
    const partialSignals = offer.reward_type === "percent" && offer.value_partial !== null && series?.partial
      ? deriveOfferSignals(series.partial, { rewardType: "percent", value: offer.value_partial }, null)
      : null;

    const storeOffers = offersByStore.get(offer.store_slug) ?? [];
    const offerBase = {
      platformId: offer.platform_id,
      platformName: offer.platform_name,
      freshness: offer.freshness,
      lastSeenAt: offer.last_seen_at.toISOString(),
    };
    const publicOffer = offer.reward_type === "percent"
      ? { ...offerBase, reward: { type: "percent" as const, value: offer.value, valuePartial: offer.value_partial, isUpto: offer.is_upto, partial: partialSignals, ...primarySignals } }
      : { ...offerBase, reward: { type: "fixed" as const, value: offer.value, currency: "BRL" as const, ...primarySignals } };
    storeOffers.push(publicOffer);
    offersByStore.set(offer.store_slug, storeOffers);
  }

  return offersByStore;
}

async function getStoreDetailUncached(slug: string): Promise<StoreDetail | null> {
  const database = getPool();
  const storeResult = await database.query(
    "select slug, name, logo_url, platform_count from web_read.store_details where slug = $1",
    [slug],
  );
  const store = StoreDetailRow.nullable().parse(storeResult.rows[0] ?? null);
  if (!store) return null;

  const offersResult = await database.query(
    `select store_slug, platform_id, platform_name, reward_type, value, value_partial, is_upto, freshness, last_seen_at,
            previous_reward_type, previous_value
     from web_read.catalog_offers
     where store_slug = $1
     order by platform_name asc, platform_id asc`,
    [slug],
  );
  const offers = z.array(CatalogOfferRow).parse(offersResult.rows);

  const historyResult = await database.query(
    "select platform_id, platform_name, reward_type, value, value_partial, changed_at from web_read.store_history($1)",
    [slug],
  );
  const history: StoreHistoryRow[] = z.array(StoreHistoryDbRow).parse(historyResult.rows).map((row) => ({
    platformId: row.platform_id,
    platformName: row.platform_name,
    rewardType: row.reward_type,
    value: row.value,
    valuePartial: row.value_partial,
    changedAt: row.changed_at.toISOString(),
  }));

  // Reaproveita a mesma leitura de histórico do gráfico (ADR-0010) para derivar boost/valor
  // típico/valor anterior — o detalhe não precisa de uma segunda ida ao banco (F3/T9/#55).
  const seriesIndex = new Map<string, StoreHistorySeries>();
  for (const series of composeStoreHistory(history, new Date())) {
    seriesIndex.set(`${store.slug}:${series.platformId}`, series);
  }

  return {
    slug: store.slug,
    name: store.name,
    logoUrl: store.logo_url,
    platformCount: store.platform_count,
    offers: mapCatalogOffers(offers, seriesIndex).get(store.slug) ?? [],
    history,
  };
}

const getCachedStoreDetail = unstable_cache(getStoreDetailUncached, ["catalog-store-detail-v3"], {
  tags: [CATALOG_CACHE_TAG],
  revalidate: CATALOG_CACHE_TTL_SECONDS,
});

export async function getStoreDetail(slug: string): Promise<StoreDetail | null> {
  return getCachedStoreDetail(slug);
}

async function getEligibleStoreSlugsUncached() {
  const result = await getPool().query("select slug from web_read.catalog_stores order by slug asc");
  return z.array(StoreSlugRow).parse(result.rows).map((row) => row.slug);
}

const getCachedEligibleStoreSlugs = unstable_cache(getEligibleStoreSlugsUncached, ["catalog-eligible-store-slugs-v1"], {
  tags: [CATALOG_CACHE_TAG],
  revalidate: CATALOG_CACHE_TTL_SECONDS,
});

export async function getEligibleStoreSlugs() {
  return getCachedEligibleStoreSlugs();
}

const getCachedCatalogPage = unstable_cache(getCatalogPageUncached, ["catalog-page-v4"], {
  tags: [CATALOG_CACHE_TAG],
  revalidate: CATALOG_CACHE_TTL_SECONDS,
});

export async function getCatalogPage(request: CatalogRequest): Promise<CatalogPage> {
  assertRequest(request);
  return getCachedCatalogPage(request);
}
