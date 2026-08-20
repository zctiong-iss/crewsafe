/** @author Tang Chee Seng (with assistance from Claude) */
import { apiFetch } from "./client";

/**
 * A supervisor accountable for a site — not the author of any particular plan. Mirrors
 * {@code OversightController.SiteSupervisor}; see its javadoc for why this is site-level
 * rather than plan-level.
 */
export interface SiteSupervisor {
  id: string;
  displayName: string;
}

/** Mirrors {@code OversightController.SitePlanSummary}. */
export interface SitePlanSummary {
  siteId: string;
  /** Plans no supervisor has decided on — the only figure that asks for action. */
  awaitingDecision: number;
  /** Every plan ever drafted for the site, decided or not. */
  totalPlans: number;
  /** The site's active supervisors, so a plan can be labelled with who is accountable for it. */
  supervisors: SiteSupervisor[];
}

/**
 * Cross-site plan counts for every site the caller belongs to. Caller-scoped — there is no
 * siteId parameter, because the scope comes from the caller's own memberships on the server
 * (see OversightController's javadoc for why this endpoint has no site to name).
 */
export function fetchPlanSummary(): Promise<SitePlanSummary[]> {
  return apiFetch<SitePlanSummary[]>("/api/v1/oversight/plan-summary");
}
