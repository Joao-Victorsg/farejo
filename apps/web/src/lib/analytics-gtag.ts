type Gtag = (...arguments_: unknown[]) => void;

export interface GooglePageViewState {
  lastPageViewLocation?: string;
}

export interface GooglePageView {
  pageLocation: string;
  pageTitle: string;
  pageReferrer: string;
  storeSlug?: string;
}

export function createGoogleTag(dataLayer: unknown[]): Gtag {
  return function gtag() {
    dataLayer.push(arguments);
  };
}

export function sendGooglePageView(
  gtag: Gtag | undefined,
  state: GooglePageViewState,
  pageView: GooglePageView,
) {
  if (!gtag || state.lastPageViewLocation === pageView.pageLocation) return;

  state.lastPageViewLocation = pageView.pageLocation;
  gtag("event", "page_view", {
    page_location: pageView.pageLocation,
    page_title: pageView.pageTitle,
    page_referrer: pageView.pageReferrer,
    ...(pageView.storeSlug ? { store_slug: pageView.storeSlug } : {}),
  });
}
