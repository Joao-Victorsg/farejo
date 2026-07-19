/**
 * Shared constants for the F3/T17 visual/a11y/responsive e2e suite. Mirrors the local Supabase
 * connection and role scoping already established by test/smoke.mts — same port, same env var
 * names the app reads in production, same per-role connection strings.
 */
export const E2E_PORT = 32151;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
// Overridable only to generate Linux-matching screenshot baselines from a container on a
// developer machine (host.docker.internal instead of 127.0.0.1) — CI never sets this.
const E2E_DB_HOST = process.env.E2E_DB_HOST ?? "127.0.0.1";
export const E2E_DATABASE_URL = `postgresql://postgres:postgres@${E2E_DB_HOST}:55322/postgres`;

export const E2E_SERVER_ENV = {
  FAREJO_WEB_DATABASE_URL: E2E_DATABASE_URL,
  FAREJO_ACTIVATION_DATABASE_URL: `${E2E_DATABASE_URL}?options=-c%20role%3Dfarejo_activation`,
  FAREJO_METRICS_DATABASE_URL: `${E2E_DATABASE_URL}?options=-c%20role%3Dfarejo_metrics`,
  FAREJO_CATALOG_INVALIDATION_SECRET: "f3t17-e2e-secret-at-least-32-characters-long",
  VERCEL: "1",
};
