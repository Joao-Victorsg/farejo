type Gtag = (...arguments_: unknown[]) => void;

export function createGoogleTag(dataLayer: unknown[]): Gtag {
  return function gtag() {
    dataLayer.push(arguments);
  };
}
