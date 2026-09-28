import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

// O sitemap deve usar a origem de runtime, inclusive após mudar a variável de ambiente.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/go/"] },
    ],
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
  };
}
