/**
 * Stand-in for `GET /api/v1/sites`.
 *
 * Unlike the weather and lightning mocks, this endpoint is REAL — `SiteController`
 * implements it, filtered by membership. Only `mock` auth mode needs this, and only because
 * there is no backend to ask. The fixtures are the same two sites `DemoDataSeeder` creates.
 */
import { DEMO_SITES } from "@/auth/demoUsers";
import type { Site } from "@/types/domain";

/**
 * Mirrors the controller's behaviour: only the caller's sites, alphabetical by name.
 *
 * The membership filter *is* the authorization there (see the comment on
 * `listAccessibleSites`), so returning everything here would hide a whole class of
 * cross-site bug in mock mode.
 */
export function mockAccessibleSites(siteIds: string[]): Site[] {
  return Object.values(DEMO_SITES)
    .filter((site) => siteIds.includes(site.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}
