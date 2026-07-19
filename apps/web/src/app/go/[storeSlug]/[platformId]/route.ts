import { after, NextResponse } from "next/server";
import { activationErrorHtml } from "../../../../components/activation-error";
import { recordActivation, resolveActivation } from "../../../../lib/activation";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// ADR-0032: a validação no caminho crítico precisa da Function na região mais próxima do
// Postgres (Supavisor). `pg` exige o runtime Node.js — nunca Edge, mesmo que vire o padrão do
// framework no futuro.
export const runtime = "nodejs";
export const preferredRegion = "gru1";

interface ActivationRouteContext {
  params: Promise<{ storeSlug: string; platformId: string }>;
}

function storeHref(storeSlug: string) {
  return `/loja/${encodeURIComponent(storeSlug)}`;
}

function errorResponse(kind: "unavailable" | "temporary", storeSlug: string, retryHref: string) {
  const status = kind === "unavailable" ? 410 : 503;
  return new NextResponse(activationErrorHtml({ kind, retryHref, storeHref: storeHref(storeSlug) }), {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export async function GET(request: Request, { params }: ActivationRouteContext) {
  const { storeSlug, platformId } = await params;
  const startedAt = performance.now();
  let resolution;

  try {
    resolution = await resolveActivation(storeSlug, platformId);
  } catch {
    console.error("activation_validation", { outcome: "temporary_failure", durationMs: Math.round(performance.now() - startedAt) });
    return errorResponse("temporary", storeSlug, new URL(request.url).pathname);
  }
  if (resolution.kind === "unavailable") {
    console.info("activation_validation", { outcome: "unavailable", durationMs: Math.round(performance.now() - startedAt) });
    return errorResponse("unavailable", storeSlug, new URL(request.url).pathname);
  }

  console.info("activation_validation", { outcome: "redirect", durationMs: Math.round(performance.now() - startedAt) });
  try {
    after(() => {
      void recordActivation(resolution.storeId, platformId).catch(() => undefined);
    });
  } catch {
    // Telemetry is explicitly best-effort and cannot change a verified redirect.
  }
  return NextResponse.redirect(resolution.destination, 307);
}
