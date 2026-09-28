import { z } from "zod";
import { reportOfferDiscrepancy } from "../../../lib/offer-feedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "gru1";

const Submission = z.object({
  storeSlug: z.string().regex(/^[a-z0-9-]{1,100}$/),
  platformId: z.string().regex(/^[a-z0-9-]{1,40}$/),
}).strict();

function jsonResponse(status: number, body: { ok: boolean; message: string }) {
  return Response.json(body, { status, headers: { "cache-control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return jsonResponse(403, { ok: false, message: "Requisição não permitida." });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return jsonResponse(415, { ok: false, message: "Formato inválido." });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 256) {
    return jsonResponse(413, { ok: false, message: "Requisição inválida." });
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 256) return jsonResponse(413, { ok: false, message: "Requisição inválida." });
    body = JSON.parse(text);
  } catch {
    return jsonResponse(400, { ok: false, message: "Requisição inválida." });
  }
  const parsed = Submission.safeParse(body);
  if (!parsed.success) return jsonResponse(400, { ok: false, message: "Requisição inválida." });

  try {
    const accepted = await reportOfferDiscrepancy(parsed.data.storeSlug, parsed.data.platformId);
    if (!accepted) return jsonResponse(404, { ok: false, message: "Oferta indisponível. Atualize a página." });
    return jsonResponse(202, { ok: true, message: "Obrigado, vamos verificar esta oferta." });
  } catch (error) {
    console.error("offer_discrepancy_report", { outcome: "temporary_failure", errorName: error instanceof Error ? error.name : "unknown" });
    return jsonResponse(503, { ok: false, message: "Não foi possível enviar agora. Tente novamente." });
  }
}
