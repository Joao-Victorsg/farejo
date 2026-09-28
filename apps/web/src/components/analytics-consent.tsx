"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createGoogleTag, sendGooglePageView } from "@/lib/analytics-gtag";
import { searchResultsEventParams } from "@/lib/search-analytics";

const CONSENT_COOKIE = "farejo_ga4_consent";
const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
const CONSENT_DENIED = {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
} as const;

type ConsentChoice = "granted" | "denied" | null;
type GoogleConsent = typeof CONSENT_DENIED | { analytics_storage: "granted"; ad_storage: "denied"; ad_user_data: "denied"; ad_personalization: "denied" };
type Gtag = (...arguments_: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    __farejoGa4ScriptRequested?: boolean;
    __farejoLastPageViewLocation?: string;
  }
}

interface AnalyticsConsentContextValue {
  choice: ConsentChoice;
  choose: (choice: Exclude<ConsentChoice, null>) => void;
  openSettings: () => void;
  settingsOpen: boolean;
  closeSettings: () => void;
  trackSearch: () => void;
}

const AnalyticsConsentContext = createContext<AnalyticsConsentContextValue | null>(null);

function getStoredChoice(): ConsentChoice {
  const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
  const value = cookie?.slice(CONSENT_COOKIE.length + 1);
  if (value === "v1.granted") return "granted";
  if (value === "v1.denied") return "denied";
  return null;
}

function saveChoice(choice: Exclude<ConsentChoice, null>) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=v1.${choice}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

function removeGoogleAnalyticsCookies() {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.trim().split("=", 1)[0];
    if (!name?.startsWith("_ga")) continue;
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${window.location.hostname}; SameSite=Lax`;
    if (window.location.hostname.includes(".")) {
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.${window.location.hostname}; SameSite=Lax`;
    }
  }
}

function initializeGoogleTag(choice: Exclude<ConsentChoice, null>) {
  if (!MEASUREMENT_ID || !/^G-[A-Z0-9]+$/.test(MEASUREMENT_ID)) return;

  window.dataLayer ??= [];
  window.gtag ??= createGoogleTag(window.dataLayer);
  window.gtag("consent", "default", CONSENT_DENIED satisfies GoogleConsent);
  if (choice === "granted") {
    window.gtag("consent", "update", {
      ...CONSENT_DENIED,
      analytics_storage: "granted",
    } satisfies GoogleConsent);
  }
  window.gtag("js", new Date());
  const pathname = window.location.pathname;
  window.gtag("set", {
    page_location: `${window.location.origin}${pathname}`,
    page_title: pageTitleForPath(pathname),
    page_referrer: safeReferrer(),
  });
  window.gtag("config", MEASUREMENT_ID, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_expires: 60 * 60 * 24 * 90,
    ...(process.env.NODE_ENV === "development" ? { debug_mode: true } : {}),
  });
  if (choice === "granted") trackPageView(pathname);

  if (!window.__farejoGa4ScriptRequested) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
    script.dataset.farejoGa4 = "true";
    document.head.append(script);
    window.__farejoGa4ScriptRequested = true;
  }
}

function pageTitleForPath(pathname: string) {
  if (pathname === "/") return "farejô | Lojas";
  if (pathname.startsWith("/loja/")) return "farejô | Página de loja";
  return `farejô | ${pathname.split("/").filter(Boolean).join(" ")}`;
}

function storeSlugForPath(pathname: string) {
  const match = /^\/loja\/([a-z0-9-]+)\/?$/.exec(pathname);
  return match?.[1];
}

function trackPageView(pathname: string) {
  const storeSlug = storeSlugForPath(pathname);
  sendGooglePageView(window.gtag, window, {
    pageLocation: `${window.location.origin}${pathname}`,
    pageTitle: pageTitleForPath(pathname),
    pageReferrer: safeReferrer(),
    ...(storeSlug ? { storeSlug } : {}),
  });
}

function safeReferrer() {
  if (!document.referrer) return "";
  try {
    const referrer = new URL(document.referrer);
    return referrer.origin === window.location.origin
      ? `${referrer.origin}${referrer.pathname}`
      : referrer.origin;
  } catch {
    return "";
  }
}

function PageViewTracker({ choice }: { choice: ConsentChoice }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryKey = searchParams.toString();

  useEffect(() => {
    if (choice !== "granted" || !MEASUREMENT_ID || !window.gtag || !pathname) return;
    trackPageView(pathname);
  }, [choice, pathname, queryKey]);

  return null;
}

export function AnalyticsConsentProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ConsentChoice>(null);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const storedChoice = getStoredChoice();
    setChoice(storedChoice);
    setReady(true);
    if (storedChoice === "granted") initializeGoogleTag("granted");
  }, []);

  const choose = useCallback((nextChoice: Exclude<ConsentChoice, null>) => {
    saveChoice(nextChoice);
    if (nextChoice === "granted") {
      initializeGoogleTag("granted");
    } else {
      window.gtag?.("consent", "update", CONSENT_DENIED satisfies GoogleConsent);
      removeGoogleAnalyticsCookies();
    }
    setChoice(nextChoice);
    setSettingsOpen(false);
  }, []);

  const trackSearch = useCallback(() => {
    if (choice === "granted") window.gtag?.("event", "search");
  }, [choice]);

  const context = useMemo<AnalyticsConsentContextValue>(() => ({
    choice,
    choose,
    openSettings: () => setSettingsOpen(true),
    settingsOpen,
    closeSettings: () => setSettingsOpen(false),
    trackSearch,
  }), [choice, choose, settingsOpen, trackSearch]);

  const isConfigured = Boolean(MEASUREMENT_ID && /^G-[A-Z0-9]+$/.test(MEASUREMENT_ID));

  return (
    <AnalyticsConsentContext.Provider value={context}>
      {children}
      <Suspense fallback={null}><PageViewTracker choice={choice} /></Suspense>
      {isConfigured && ready && (choice === null || settingsOpen) ? (
        <AnalyticsConsentNotice
          choice={choice}
          onChoose={choose}
          onClose={() => setSettingsOpen(false)}
          settingsOpen={settingsOpen}
        />
      ) : null}
    </AnalyticsConsentContext.Provider>
  );
}

export function useAnalyticsConsent() {
  const context = useContext(AnalyticsConsentContext);
  if (!context) throw new Error("useAnalyticsConsent deve ser usado dentro de AnalyticsConsentProvider");
  return context;
}

/** A página informa só a faixa; a query nunca entra no evento. */
export function SearchResultsTracker({ resultCount }: { resultCount: number }) {
  const { choice } = useAnalyticsConsent();
  useEffect(() => {
    if (choice !== "granted" || !MEASUREMENT_ID || !window.gtag) return;
    window.gtag("event", "search_results_view", searchResultsEventParams(new URL(window.location.href), resultCount));
  }, [choice, resultCount]);
  return null;
}

export function AnalyticsPreferencesButton() {
  const { openSettings } = useAnalyticsConsent();
  if (!MEASUREMENT_ID || !/^G-[A-Z0-9]+$/.test(MEASUREMENT_ID)) return null;
  return <button className="rounded-sm font-semibold text-[#1c7a4d] underline hover:text-[#16633f] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1c7a4d]" onClick={openSettings} type="button">Gerenciar cookies de analytics</button>;
}

function AnalyticsConsentNotice({
  choice,
  onChoose,
  onClose,
  settingsOpen,
}: {
  choice: ConsentChoice;
  onChoose: (choice: Exclude<ConsentChoice, null>) => void;
  onClose: () => void;
  settingsOpen: boolean;
}) {
  return (
    <section aria-label="Preferências de privacidade" className="fixed inset-x-3 bottom-3 z-[60] max-h-[85dvh] overflow-y-auto rounded-2xl border border-[#d7ddd6] bg-white p-5 text-[#12140f] shadow-[0_12px_48px_-12px_rgba(0,0,0,.32)] sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[min(32rem,calc(100vw-2.5rem))] sm:p-6" role="region">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-medium tracking-[0.13em] text-[#1c7a4d]">PREFERÊNCIAS DE COOKIES</p>
          <h2 className="mt-2 text-xl font-bold tracking-[-0.03em]">Sua escolha sobre cookies de analytics</h2>
        </div>
        {settingsOpen ? <button aria-label="Fechar preferências" className="min-h-10 rounded-lg px-3 text-sm font-semibold hover:bg-[#f6f5f0]" onClick={onClose} type="button">Fechar</button> : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-[#5b5f56]">Usamos cookies opcionais de analytics para entender como o site e suas páginas são usados e orientar melhorias na navegação. Eles ficam desativados até você aceitar. Recusar não afeta o uso do site, e você pode mudar de ideia a qualquer momento.</p>
      {settingsOpen ? (
        <div className="mt-4 rounded-xl border border-[#e0ddd4] bg-[#faf9f5] p-4">
          <p className="font-semibold">Cookies de analytics (opcionais)</p>
          <p className="mt-1 text-sm leading-6 text-[#5b5f56]">Desativados até você aceitar. Ajudam a entender páginas visitadas e ações no site. Não coletamos os termos pesquisados nem usamos esses cookies para publicidade.</p>
          <p className="mt-2 text-xs text-[#70736a]">Preferência atual: {choice === "granted" ? "aceita" : choice === "denied" ? "recusada" : "ainda não escolhida"}.</p>
        </div>
      ) : null}
      <p className="mt-3 text-sm text-[#5b5f56]">Leia também a <a className="font-semibold text-[#1c7a4d] underline" href="/privacidade">página de privacidade</a>.</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <button className="min-h-11 rounded-xl border border-[#1c7a4d] bg-white px-4 text-sm font-semibold text-[#1c7a4d] hover:bg-[#f2f9f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d]" onClick={() => onChoose("granted")} type="button">Aceitar cookies de analytics</button>
        <button className="min-h-11 rounded-xl border border-[#1c7a4d] bg-white px-4 text-sm font-semibold text-[#1c7a4d] hover:bg-[#f2f9f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d]" onClick={() => onChoose("denied")} type="button">{choice === "granted" ? "Revogar e recusar cookies" : "Recusar cookies de analytics"}</button>
      </div>
    </section>
  );
}
