/**
 * The worker home screen's data.
 *
 * Every function here has the same shape: the real request, written out and commented, next
 * to the mock that currently answers it. Switching to the real backend is deleting a
 * branch, not rewriting a call site — the screens above never learn which one ran.
 *
 * All three are mocked unconditionally today, not just in `mock` auth mode, because none of
 * the endpoints exist on any deployment. That is the difference between this and
 * `identity.ts`, where the real path works and only mock mode diverges.
 */
import type { LightningRisk, MyShift, PolicyEvaluation, SiteConditions } from "@/types/domain";
import { mockLightningRisk } from "../mock/lightning";
import { mockConditions } from "../mock/conditions";
import { mockMyShift } from "../mock/myShift";

/** Simulates a round trip, so loading states are visible rather than theoretical. */
const MOCK_LATENCY_MS = 350;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_LATENCY_MS));
}

/**
 * `GET /api/v1/shifts/me` — SCRUM-162, contract in `docs/api/shift-readiness.yaml`.
 *
 * Real implementation:
 *   return request<MyShiftResponse>({ url: "/api/v1/shifts/me", method: "GET" });
 *
 * Returns null when the worker has no current or upcoming shift — a legitimate answer, not
 * an error, and the screen has an empty state for it.
 */
export function fetchMyShift(): Promise<MyShift | null> {
  return delay(mockMyShift());
}

/**
 * `GET /api/v1/sites/{siteId}/lightning` — SCRUM-170, blocking SCRUM-172.
 *
 * Real implementation:
 *   return request<LightningRisk>({ url: `/api/v1/sites/${siteId}/lightning`, method: "GET" });
 *
 * See `api/mock/lightning.ts` for the full response shape this commits to and why
 * `validUntil` has to come from the server.
 */
export function fetchLightningRisk(siteId: string): Promise<LightningRisk> {
  return delay(mockLightningRisk(siteId));
}

export interface SiteConditionsResponse {
  observation: SiteConditions;
  policy: PolicyEvaluation;
}

/**
 * `GET /api/v1/sites/{siteId}/conditions` — §12.1 of the project plan.
 *
 * Real implementation:
 *   return request<SiteConditionsResponse>({
 *     url: `/api/v1/sites/${siteId}/conditions`, method: "GET",
 *   });
 *
 * `intensity` and `workerId` are arguments only because the mock evaluates policy locally.
 * The real endpoint derives both server-side from the caller's assignment — a client that
 * could name its own intensity could choose its own heat-rest obligation.
 */
export function fetchSiteConditions(
  siteId: string,
  intensity: MyShift["assignment"]["intensity"],
  workerId: string,
): Promise<SiteConditionsResponse> {
  return delay(mockConditions(siteId, intensity, workerId));
}
