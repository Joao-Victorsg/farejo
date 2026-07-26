// `package.json`'s `main`/`types` apontam pra este arquivo `.ts` cru, mesma forma que
// `@farejo/postgres` tinha até o incidente do #120: um bundler que trate workspace packages como
// dependência normal (não `tsx`/`transpilePackages`) não consegue executar isto. Hoje é dormente —
// só consumido via `tsx` (scraper) e como `devDependency` não-importada em runtime pelo site — mas
// se um dia virar dependência de algo que a Vercel empacota diretamente, precisa do mesmo tratamento
// (`pnpm build` real pra `dist/`, ver `packages/postgres/src/index.ts`), não redescobrir do zero.
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
