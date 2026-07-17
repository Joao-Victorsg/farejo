import "server-only";
import { unstable_cache } from "next/cache";
import { Pool } from "pg";
import { z } from "zod";
import { CATALOG_CACHE_TAG, CATALOG_CACHE_TTL_SECONDS } from "./catalog-cache";

export const CATALOG_PAGE_SIZE = 24;

const CatalogStoreRow = z.object({
  slug: z.string(),
  name: z.string(),
  logo_url: z.string().url().nullable(),
  platform_count: z.number().int().positive(),
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

const CatalogCountRow = z.object({ count: z.number().int().nonnegative() });

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

function assertPage(page: number) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("Invalid catalog page");
}

async function getCatalogPageUncached(page: number): Promise<CatalogPage> {
  const offset = (page - 1) * CATALOG_PAGE_SIZE;
  const database = getPool();

  const [storesResult, countResult] = await Promise.all([
    database.query(
      `select slug, name, logo_url, platform_count
       from web_read.catalog_stores
       order by platform_count desc, name asc, slug asc
       limit $1 offset $2`,
      [CATALOG_PAGE_SIZE, offset],
    ),
    database.query("select count(*)::integer as count from web_read.catalog_stores"),
  ]);

  const stores = z.array(CatalogStoreRow).parse(storesResult.rows);
  const count = CatalogCountRow.parse(countResult.rows[0]).count;
  const slugs = stores.map((store) => store.slug);
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
    const offerBase = {
      platformId: offer.platform_id,
      platformName: offer.platform_name,
      freshness: offer.freshness,
    };
    const publicOffer = offer.reward_type === "percent"
      ? { ...offerBase, reward: { type: "percent" as const, value: offer.value, valuePartial: offer.value_partial, isUpto: offer.is_upto } }
      : { ...offerBase, reward: { type: "fixed" as const, value: offer.value, currency: "BRL" as const } };
    storeOffers.push(publicOffer);
    offersByStore.set(offer.store_slug, storeOffers);
  }

  return {
    items: stores.map((store) => ({
      slug: store.slug,
      name: store.name,
      logoUrl: store.logo_url,
      platformCount: store.platform_count,
      offers: offersByStore.get(store.slug) ?? [],
    })),
    page,
    total: count,
    totalPages: Math.ceil(count / CATALOG_PAGE_SIZE),
  };
}

const getCachedCatalogPage = unstable_cache(getCatalogPageUncached, ["catalog-page"], {
  tags: [CATALOG_CACHE_TAG],
  revalidate: CATALOG_CACHE_TTL_SECONDS,
});

export async function getCatalogPage(page: number): Promise<CatalogPage> {
  assertPage(page);
  return getCachedCatalogPage(page);
}
