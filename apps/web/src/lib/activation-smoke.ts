import { createHmac, timingSafeEqual } from "node:crypto";
import type { ActivationSource } from "./activation.js";

const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1_000;
const SIGNATURE_PATTERN = /^[a-f\d]{64}$/i;

export function activationSourceForRequest(request: Request, now = Date.now()): ActivationSource {
  const secret = process.env.FAREJO_CATALOG_INVALIDATION_SECRET;
  const timestamp = request.headers.get("x-farejo-smoke-timestamp");
  const signature = request.headers.get("x-farejo-smoke-signature");

  if (!secret || !timestamp || !/^\d{13}$/.test(timestamp) || !signature || !SIGNATURE_PATTERN.test(signature)) {
    return "user";
  }

  if (Math.abs(now - Number(timestamp)) > MAX_SIGNATURE_AGE_MS) return "user";

  const pathname = new URL(request.url).pathname;
  const expected = createHmac("sha256", secret)
    .update(timestamp)
    .update(`${request.method}\n${pathname}`)
    .digest();
  const received = Buffer.from(signature, "hex");

  return received.byteLength === expected.byteLength && timingSafeEqual(received, expected)
    ? "production_smoke"
    : "user";
}
