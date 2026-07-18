"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "farejo:inter-correntista";

interface InterPreferenceValue {
  isCorrentista: boolean;
  setIsCorrentista: (value: boolean) => void;
}

const InterPreferenceContext = createContext<InterPreferenceValue | null>(null);

export function InterPreferenceProvider({ children }: { children: React.ReactNode }) {
  const [isCorrentista, setIsCorrentistaState] = useState(true);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "0") setIsCorrentistaState(false);
    } catch {
      // localStorage indisponível: mantém o padrão ligado.
    }
  }, []);

  const setIsCorrentista = useCallback((value: boolean) => {
    setIsCorrentistaState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // localStorage indisponível: preferência vale só para esta sessão de página.
    }
  }, []);

  const value = useMemo(() => ({ isCorrentista, setIsCorrentista }), [isCorrentista, setIsCorrentista]);

  return <InterPreferenceContext.Provider value={value}>{children}</InterPreferenceContext.Provider>;
}

export function useInterPreference() {
  const context = useContext(InterPreferenceContext);
  if (!context) throw new Error("useInterPreference must be used within InterPreferenceProvider");
  return context;
}
