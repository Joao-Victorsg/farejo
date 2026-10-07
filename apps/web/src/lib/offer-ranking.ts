import type { CatalogOffer, PlatformStat } from "./catalog";
import { NO_OFFER_SIGNALS, type OfferSignals } from "./history";

export const INTER_PLATFORM_ID = "inter";

/**
 * `/plataformas` (ADR-0025): todas as 5 plataformas com cobertura zero ao mesmo tempo é uma
 * anomalia de dados, não o vazio legítimo de uma única plataforma sem lojas ainda.
 */
export function isAnomalousPlatformCoverage(stats: PlatformStat[]) {
  return stats.length === 0 || stats.every((stat) => stat.storeCount === 0);
}

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

export function effectiveValue(offer: CatalogOffer, isCorrentista: boolean) {
  if (offer.reward.type !== "percent") return offer.reward.value;
  if (!isCorrentista && isInterCorrentistaOffer(offer)) return offer.reward.valuePartial ?? offer.reward.value;
  return offer.reward.value;
}

export function sameRankValue(left: CatalogOffer, right: CatalogOffer, isCorrentista: boolean) {
  if (left.reward.type !== right.reward.type) return false;
  if (left.reward.type === "fixed" && right.reward.type === "fixed" && left.reward.currency !== right.reward.currency) return false;
  return effectiveValue(left, isCorrentista) === effectiveValue(right, isCorrentista);
}

export function rankOffers(offers: CatalogOffer[], isCorrentista = true) {
  return [...offers].sort((left, right) => {
    if (left.reward.type !== right.reward.type) return left.reward.type === "percent" ? -1 : 1;
    const valueDifference = effectiveValue(right, isCorrentista) - effectiveValue(left, isCorrentista);
    if (valueDifference !== 0) return valueDifference;
    if (left.reward.type === "fixed" && right.reward.type === "fixed") {
      const currencyDifference = left.reward.currency.localeCompare(right.reward.currency);
      if (currencyDifference !== 0) return currencyDifference;
    }
    return left.platformId.localeCompare(right.platformId);
  });
}

export function leaderOffers(rankedOffers: CatalogOffer[], isCorrentista = true) {
  const first = rankedOffers[0];
  return first ? rankedOffers.filter((offer) => sameRankValue(offer, first, isCorrentista)) : [];
}

export function competitionPosition(rankedOffers: CatalogOffer[], index: number, isCorrentista = true) {
  const offer = rankedOffers[index];
  if (!offer) return index + 1;
  const firstEqualIndex = rankedOffers.findIndex((candidate) => sameRankValue(candidate, offer, isCorrentista));
  return firstEqualIndex + 1;
}

export function formatLeaderValue(offer: CatalogOffer, isCorrentista = true) {
  if (offer.reward.type === "percent") return `${effectiveValue(offer, isCorrentista).toLocaleString("pt-BR")}%`;
  return formatReward(offer, isCorrentista);
}

export function formatReward(offer: CatalogOffer, isCorrentista = true) {
  if (offer.reward.type === "percent") {
    const value = effectiveValue(offer, isCorrentista);
    return `${offer.reward.isUpto ? "Até " : ""}${value.toLocaleString("pt-BR")}%`;
  }
  return offer.reward.value.toLocaleString("pt-BR", { style: "currency", currency: offer.reward.currency });
}
