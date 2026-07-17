import "server-only";
import { z } from "zod";

const SiteUrl = z.string().url().transform((value) => new URL(value));

export function getSiteUrl() {
  return SiteUrl.parse(process.env.FAREJO_SITE_URL ?? "https://farejo.com.br");
}
