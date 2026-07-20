"use client";

import { useInterPreference } from "@/lib/inter-preference";

interface InterToggleProps {
  compact?: boolean;
}

export function InterToggle({ compact = false }: InterToggleProps) {
  const { isCorrentista, setIsCorrentista } = useInterPreference();

  const button = (
    <button
      aria-checked={isCorrentista}
      aria-label="Sou correntista Inter"
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d] ${isCorrentista ? "bg-[#12140f]" : "bg-[#d8d4c8]"}`}
      onClick={() => setIsCorrentista(!isCorrentista)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${isCorrentista ? "translate-x-5" : "translate-x-1"}`} />
    </button>
  );

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {button}
        <span className="text-sm font-medium">Correntista Inter</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#e0ddd4] bg-white px-4 py-3">
      {button}
      <span className="flex flex-col">
        <span className="text-sm font-semibold">Correntista Inter</span>
        <span className="text-xs text-[#5b5f56]">{isCorrentista ? "Mostrando taxa de correntista" : "Mostrando taxa de não correntista"}</span>
      </span>
    </div>
  );
}
