/**
 * Plan counts for `mock` auth mode.
 *
 * Derived from the same fixtures the mock recommendation list serves, rather than being a
 * separate hand-written table. A count that disagreed with the plans behind it would reproduce
 * exactly the bug this endpoint was added to fix — a badge saying one thing and the expanded
 * row saying another.
 *
 * @author Justin Chua
 */
import { DEMO_SITES } from "@/auth/demoUsers";
import { mockListShifts } from "./shifts";
import { mockListRecommendations } from "./recommendations";
import type { SitePlanSummary } from "../endpoints/oversight";

export function mockPlanSummary(): SitePlanSummary[] {
  // DEMO_SITES is keyed by name, not a list — the values are what this iterates.
  return Object.values(DEMO_SITES).map((site) => {
    const plans = mockListShifts(site.id).flatMap((shift) => mockListRecommendations(shift.id));

    return {
      siteId: site.id,
      awaitingDecision: plans.filter((plan) => plan.status === "PENDING_APPROVAL").length,
      totalPlans: plans.length,
      // One supervisor per demo site, matching the seeded memberships. Two would be a better
      // exercise of the pill row, but the fixture should mirror the data it stands in for.
      supervisors: [{ id: `sup-${site.id}`, displayName: "Zhong Cheng" }],
    };
  });
}
