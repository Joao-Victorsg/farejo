import type { MetadataRoute } from "next";
import { catalogHref, getCatalogPage } from "@/lib/catalog";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const catalog = await getCatalogPage({ page: 1, query: "", sort: "platforms" });
  const pages = Array.from({ length: Math.max(catalog.totalPages - 1, 0) }, (_, index) => ({
    url: new URL(catalogHref({ page: index + 2, query: "", sort: "platforms" }), siteUrl).toString(),
  }));

  return [
    { url: new URL("/", siteUrl).toString() },
    ...pages,
    { url: new URL("/plataformas", siteUrl).toString() },
    { url: new URL("/como-funciona", siteUrl).toString() },
    { url: new URL("/faq", siteUrl).toString() },
  ];
}
