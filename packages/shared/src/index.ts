export { RawOfferSchema } from "./contract.js";
export type { RawOffer, RunScope, ScrapeResult, ScrapeInstruction, SlugOutcome, PlatformAdapter } from "./contract.js";
export { createClient } from "./db.js";
export type { Database, Tables, TablesInsert, TablesUpdate } from "./database.types.js";
export { ParseError, parseReward } from "./reward.js";
export type { Reward } from "./reward.js";
export { l2Key, l3Key } from "./normalize.js";
export { levenshteinDistance, levenshteinRatio } from "./similarity.js";
export { isSquareish, pickBestLogoSource } from "./logo.js";
export type { LogoSourceCandidate } from "./logo.js";
export { RetryableError, NotFoundError, CircuitBreakerError } from "./errors.js";
export { evaluateSanity, SANITY_THRESHOLDS } from "./sanity.js";
export type { RunScopeLabel, SanityActual, SanityBaseline, SanityTrip, SanityVerdict } from "./sanity.js";
export { nextThrottleMultiplier, THROTTLE_THRESHOLDS } from "./throttle.js";
export type { ThrottleMultiplier, ThrottleRunOutcome } from "./throttle.js";
export {
  AliasManifestSchema,
  AliasMergeDecisionSchema,
  AliasRefSchema,
  AliasRejectDecisionSchema,
  generateAliasCandidates,
  parseAliasManifest,
  validateManifestInvariants,
} from "./curation.js";
export type {
  AliasCandidate,
  AliasCandidateSignal,
  AliasManifest,
  AliasMergeDecision,
  AliasRef,
  AliasRejectDecision,
  CanonicalStoreView,
  ManifestInvariantViolation,
} from "./curation.js";
