import "server-only";
import { z } from "zod";

const GoogleAnalyticsConfiguration = z.object({
  measurementId: z.string().regex(/^G-[A-Z0-9]+$/),
  apiSecret: z.string().min(1),
});

function requestCookies(request: Request) {
  return new Map((request.headers.get("cookie") ?? "").split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return [];
    return [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()] as const];
  }));
}

export interface ActivationAnalyticsContext {
  storeSlug: string;
  platformId: string;
}

/** Send only after a valid offer has produced its 307. Identifiers are read from the request and never persisted here. */
export async function recordGa4Redirect(request: Request, context: ActivationAnalyticsContext) {
  const parsedConfiguration = GoogleAnalyticsConfiguration.safeParse({
    measurementId: process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID,
    apiSecret: process.env.GA4_API_SECRET,
  });
  if (!parsedConfiguration.success) return;

  const configuration = parsedConfiguration.data;
  const cookies = requestCookies(request);
  if (cookies.get("farejo_ga4_consent") !== "v1.granted") return;

  const clientId = cookies.get("_ga");
  const sessionCookie = cookies.get(`_ga_${configuration.measurementId.slice(2)}`);
  if (!clientId || !sessionCookie) return;

  const destination = new URL("https://www.google-analytics.com/mp/collect");
  destination.searchParams.set("measurement_id", configuration.measurementId);
  destination.searchParams.set("api_secret", configuration.apiSecret);

  const requestUrl = new URL(request.url);
  const response = await fetch(destination, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      events: [{
        name: "activation_redirect",
        params: {
          session_id: sessionCookie,
          page_location: `${requestUrl.origin}${requestUrl.pathname}`,
          store_slug: context.storeSlug,
          platform_id: context.platformId,
          ...(process.env.NODE_ENV === "development" ? { debug_mode: true } : {}),
        },
      }],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(1_500),
  });

  if (!response.ok) throw new Error(`Google Analytics Measurement Protocol respondeu HTTP ${response.status}`);
}
