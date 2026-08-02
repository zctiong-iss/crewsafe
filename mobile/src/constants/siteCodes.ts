/**
 * The site codes a new worker can name when requesting an account.
 *
 * ── MISSING BACKEND DATA ────────────────────────────────────────────────────────────────
 * This list is hardcoded because there is no way to fetch it. `GET /api/v1/sites` requires
 * a bearer token and returns only the sites the *caller* belongs to — which is exactly
 * nothing to someone who has no account yet. There is no unauthenticated site directory.
 *
 * The values are not invented: `bishan` and `campus` are the only two accepted by the
 * `site_codes` enum in `.github/cognito/shared-config.schema.json`, and the two sites
 * `DemoDataSeeder` reconciles. So this is accurate for this deployment and wrong the moment
 * a third site is added.
 *
 * To make it real, the backend needs an unauthenticated, non-enumerable site list — for
 * example `GET /api/v1/public/sites` returning `[{ code, name }]`, rate-limited and with no
 * membership or headcount detail, since anything more would leak organisational structure
 * to an unauthenticated caller. Until then, this file is the contract.
 * ────────────────────────────────────────────────────────────────────────────────────────
 */

export interface SiteOption {
  /** Matches the `site_codes` enum the seeder validates against. */
  code: "bishan" | "campus";
  /** Not translated: these are proper nouns and appear identically in the seeder. */
  name: string;
}

export const SITE_OPTIONS: readonly SiteOption[] = [
  { code: "bishan", name: "Bishan Park Landscaping" },
  { code: "campus", name: "NUS Campus Maintenance" },
];
