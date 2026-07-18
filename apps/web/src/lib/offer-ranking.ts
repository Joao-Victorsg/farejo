import type { CatalogOffer } from "./catalog";

export const INTER_PLATFORM_ID = "inter";

export function isInterCorrentistaOffer(offer: CatalogOffer) {
  return offer.platformId === INTER_PLATFORM_ID && offer.reward.type === "percent" && offer.reward.valuePartial !== null;
}

function effectiveValue(offer: CatalogOffer, isCorrentista: boolean) {
  if (offer.reward.type !== "percent") return offer.reward.value;
  if (!isCorrentista && isInterCorrentistaOffer(offer)) return offer.reward.valuePartial as number;
  return offer.reward.value;
}

export function rankOffers(offers: CatalogOffer[], isCorrentista = true) {
  return [...offers].sort((left, right) => {
    if (left.reward.type !== right.reward.type) return left.reward.type === "percent" ? -1 : 1;
    return effectiveValue(right, isCorrentista) - effectiveValue(left, isCorrentista);
  });
}

export function formatReward(offer: CatalogOffer, isCorrentista = true) {
  if (offer.reward.type === "percent") {
    const value = effectiveValue(offer, isCorrentista);
    return `${offer.reward.isUpto ? "Até " : ""}${value.toLocaleString("pt-BR")}%`;
  }
  return offer.reward.value.toLocaleString("pt-BR", { style: "currency", currency: offer.reward.currency });
}
