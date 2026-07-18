import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { CATALOG_CACHE_TAG } from "../../../../lib/catalog-cache";

const MAX_BODY_BYTES = 4 * 1024;
const MAX_EVENT_AGE_MS = 5 * 60 * 1_000;

const InvalidationEvent = z.object({
  // "curation" (F3/T12, #58): aplicação do manifesto de aliases também invalida o catálogo
  // quando muda estado público, mas não tem scrape_runs.id nem plataforma associada.
  platform_id: z.enum(["inter", "meliuz", "cuponomia", "mycashback", "zoom", "curation"]),
  run_id: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
});

const InvalidationEnvironment = z.object({
  FAREJO_CATALOG_INVALIDATION_SECRET: z.string().min(32),
});

function rejected(): Response {
  return new Response(null, { status: 401 });
}

function isHttps(request: Request): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  return process.env.VERCEL === "1" && request.headers.get("x-forwarded-proto") === "https";
}

function hasJsonContentType(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0] === "application/json";
}

export async function POST(request: Request): Promise<Response> {
  if (!isHttps(request) || !hasJsonContentType(request)) return rejected();

  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) return rejected();

  const timestamp = request.headers.get("x-farejo-timestamp");
  const signature = request.headers.get("x-farejo-signature");
  if (!timestamp || !/^\d{13}$/.test(timestamp) || !signature || !/^[a-f\d]{64}$/i.test(signature)) return rejected();
  if (Math.abs(Date.now() - Number(timestamp)) > MAX_EVENT_AGE_MS) return rejected();

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.byteLength > MAX_BODY_BYTES) return rejected();

  const environment = InvalidationEnvironment.safeParse(process.env);
  if (!environment.success) return new Response(null, { status: 503 });

  const expectedSignature = createHmac("sha256", environment.data.FAREJO_CATALOG_INVALIDATION_SECRET).update(timestamp).update(rawBody).digest();
  const receivedSignature = Buffer.from(signature, "hex");
  if (receivedSignature.byteLength !== expectedSignature.byteLength || !timingSafeEqual(receivedSignature, expectedSignature)) return rejected();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return rejected();
  }
  const parsed = InvalidationEvent.safeParse(payload);
  if (!parsed.success || String(parsed.data.timestamp) !== timestamp) return rejected();

  revalidateTag(CATALOG_CACHE_TAG, { expire: 0 });
  return new Response(null, { status: 204 });
}
