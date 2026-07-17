"use client";

import { useEffect, useState } from "react";

function formatExactDate(instant: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(instant));
}

function formatRelativeFreshness(instant: string, now: number) {
  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(instant).getTime()) / 60_000));
  const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "always", style: "short" });
  if (elapsedMinutes < 60) return `Atualizado ${formatter.format(-elapsedMinutes, "minute")}`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const relativeHours = formatter.format(-elapsedHours, "hour");
  return elapsedHours < 24 ? `Atualizado ${relativeHours}` : `Verificação atrasada ${relativeHours}`;
}

export function FreshnessSummary({ lastSeenAt }: { lastSeenAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const exactDate = formatExactDate(lastSeenAt);
  return <time aria-label={`${formatRelativeFreshness(lastSeenAt, now)}. Última verificação em ${exactDate}.`} className="text-sm text-[#5b5f56]" dateTime={lastSeenAt}>{formatRelativeFreshness(lastSeenAt, now)}<span className="sr-only">. Última verificação em {exactDate}.</span></time>;
}
