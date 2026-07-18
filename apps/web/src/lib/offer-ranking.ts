import type { CatalogOffer } from "./catalog";
import { NO_OFFER_SIGNALS, type OfferSignals } from "./history";

export const INTER_PLATFORM_ID = "inter";

export function isInterCorrentistaOffer(offer: CatalogOffer) {
  return offer.platformId === INTER_PLATFORM_ID && offer.reward.type === "percent" && offer.reward.valuePartial !== null;
}

/**
 * Boost/valor típico/valor anterior da modalidade vigente (ADR-0012/0013): para o Inter com o
 * toggle desligado, isso é a baseline independente de `value_partial` — nunca a de `value`
 * como fallback (mesma regra de `effectiveValue`, ADR-0011).
 */
export function effectiveSignals(offer: CatalogOffer, isCorrentista: boolean): OfferSignals {
  if (offer.reward.type === "percent" && !isCorrentista && isInterCorrentistaOffer(offer)) {
    // `partial` ausente (baseline própria insuficiente) nunca reaproveita a de correntista.
    return offer.reward.partial ?? NO_OFFER_SIGNALS;
  }
  return { isBoost: offer.reward.isBoost, typicalValue: offer.reward.typicalValue, previousValue: offer.reward.previousValue, validUntil: offer.reward.validUntil };
}

/** `null` quando não há valor anterior sustentado para a modalidade vigente (ADR-0013). */
export function formatPreviousValue(offer: CatalogOffer, isCorrentista = true) {
  const { previousValue } = effectiveSignals(offer, isCorrentista);
  if (previousValue === null) return null;
  return offer.reward.type === "percent"
    ? `${previousValue.toLocaleString("pt-BR")}%`
    : previousValue.toLocaleString("pt-BR", { style: "currency", currency: offer.reward.currency });
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
