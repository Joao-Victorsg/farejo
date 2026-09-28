"use client";

import { useState } from "react";

type SubmissionState = "idle" | "submitting" | "sent" | "error";

export function OfferDiscrepancyButton({ storeSlug, platformId }: { storeSlug: string; platformId: string }) {
  const [state, setState] = useState<SubmissionState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function submit() {
    if (state === "submitting" || state === "sent") return;
    setState("submitting");
    try {
      const response = await fetch("/api/offer-discrepancy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storeSlug, platformId }),
      });
      if (!response.ok) {
        setErrorMessage(response.status === 429 ? "Muitos avisos agora. Tente novamente em um minuto." : "Não foi possível enviar agora. Tente novamente.");
        setState("error");
        return;
      }
      setState("sent");
    } catch {
      setErrorMessage("Não foi possível enviar agora. Tente novamente.");
      setState("error");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button className="min-h-10 rounded-lg px-2 text-xs font-semibold text-[#5b5f56] underline underline-offset-2 hover:text-[#1c7a4d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d] disabled:no-underline" disabled={state === "submitting" || state === "sent"} onClick={() => { void submit(); }} type="button">
        {state === "sent" ? "Aviso enviado" : state === "submitting" ? "Enviando…" : "Valor diferente na plataforma?"}
      </button>
      <span aria-live="polite" className="max-w-52 text-right text-xs text-[#5b5f56]" role="status">{state === "sent" ? "Obrigado, vamos verificar esta oferta." : state === "error" ? errorMessage : ""}</span>
    </div>
  );
}
