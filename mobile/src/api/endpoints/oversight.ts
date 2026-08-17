/**
 * Cross-site plan counts for the safety manager's oversight list.
 *
 * REAL — `OversightController` implements this. Only `mock` auth mode diverges, and only for
 * want of a backend.
 *
 *   GET /api/v1/oversight/plan-summary   SUPERVISOR / SAFETY_MANAGER / ADMIN
 *
 * ── WHY THIS IS NOT SITE-SCOPED ─────────────────────────────────────────────────────────
 * Every other plan call names its site. This one deliberately does not: it answers "across
 * everything I oversee, where is work outstanding?", and the scope comes from the caller's own
 * memberships server-side. A manager on twenty sites would otherwise make twenty requests to
 * populate one list of badges.
 *
 * @author Justin Chua
 */
import { request } from "../client";
import { isMockApi } from "@/auth/authMode";
import { mockPlanSummary } from "../mock/oversight";

const MOCK_LATENCY_MS = 250;

/**
 * Mirrors `OversightController.SiteSupervisor`.
 *
 * A supervisor accountable for the SITE, not the author of a plan. Nothing records who drafted
 * a recommendation, and most are drafted by the scheduler with no human involved at all — so
 * this is the question that has an answer, and it must not be rendered as authorship.
 */
export interface SiteSupervisor {
  id: string;
  displayName: string;
}

/** Mirrors `OversightController.SitePlanSummary`. */
export interface SitePlanSummary {
  siteId: string;
  /** Plans no supervisor has decided on. The only figure that asks for action. */
  awaitingDecision: number;
  totalPlans: number;
  /** Optional so a backend predating it renders no pill rather than crashing on undefined. */
  supervisors?: SiteSupervisor[];
}

/**
 * Counts for every site the caller belongs to, including sites with no plans (as zeroes).
 *
 * The server fills those in rather than omitting them, so the caller never has to know that an
 * absent site means zero — see `OversightController` for why that rule was not left to clients.
 */
export function fetchPlanSummary(): Promise<SitePlanSummary[]> {
  if (isMockApi()) {
    return new Promise((resolve) => setTimeout(() => resolve(mockPlanSummary()), MOCK_LATENCY_MS));
  }
  return request<SitePlanSummary[]>({ url: "/api/v1/oversight/plan-summary", method: "GET" });
}
