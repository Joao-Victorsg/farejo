"use client";

import { useInterPreference } from "@/lib/inter-preference";

interface InterToggleProps {
  compact?: boolean;
}

export function InterToggle({ compact = false }: InterToggleProps) {
  const { isCorrentista, setIsCorrentista } = useInterPreference();

  return (
    <div className={compact ? "flex items-center gap-2" : "flex items-center gap-3 rounded-xl border border-[#e0ddd4] bg-white px-4 py-3"}>
      <span className="flex flex-col">
        <span className={compact ? "text-xs font-semibold" : "text-sm font-semibold"}>Correntista Inter</span>
        {compact ? null : <span className="text-xs text-[#5b5f56]">{isCorrentista ? "Mostrando taxa de correntista" : "Mostrando taxa de não correntista"}</span>}
      </span>
      <button
        aria-checked={isCorrentista}
        aria-label="Sou correntista Inter"
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d] ${isCorrentista ? "bg-[#1c7a4d]" : "bg-[#d8d4c8]"}`}
        onClick={() => setIsCorrentista(!isCorrentista)}
        role="switch"
        type="button"
      >
        <span aria-hidden="true" className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${isCorrentista ? "translate-x-5" : "translate-x-1"}`} />
      </button>
    </div>
  );
}
