type Gtag = (...arguments_: unknown[]) => void;

export interface GooglePageViewState {
  __farejoLastPageViewLocation?: string;
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
  if (!gtag || state.__farejoLastPageViewLocation === pageView.pageLocation) return;

  state.__farejoLastPageViewLocation = pageView.pageLocation;
  gtag("event", "page_view", {
    page_location: pageView.pageLocation,
    page_title: pageView.pageTitle,
    page_referrer: pageView.pageReferrer,
    ...(pageView.storeSlug ? { store_slug: pageView.storeSlug } : {}),
  });
}
