import type { CatalogOffer } from "./catalog";

export function rankOffers(offers: CatalogOffer[]) {
  return [...offers].sort((left, right) => {
    if (left.reward.type !== right.reward.type) return left.reward.type === "percent" ? -1 : 1;
    return right.reward.value - left.reward.value;
  });
}

export function formatReward(offer: CatalogOffer) {
  if (offer.reward.type === "percent") return `${offer.reward.isUpto ? "Até " : ""}${offer.reward.value.toLocaleString("pt-BR")}%`;
  return offer.reward.value.toLocaleString("pt-BR", { style: "currency", currency: offer.reward.currency });
}
