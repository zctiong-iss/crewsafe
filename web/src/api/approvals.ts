/**@author Tang Chee Seng (with assistance from Claude) */

import { apiFetch } from "./client";

/**
 * One suggested mitigation per recommendation. 
 * Only the first four fields are guaranteed.
 */
export interface MitigationSuggestion {
  priority: string;
  action: string;
  rationale: string;
  estimatedImpact: string;
  actionCode?: string | null;
  category?: string | null;
  origin?: "MANDATORY" | "ADVISORY" | null;
  ruleReference?: string | null;
  appliesTo?: string[] | null;
  timing?: MitigationTiming | null;
}

export interface MitigationTiming {
  durationMinutes: number | null;
  everyMinutes: number | null;
  startByUtc: string | null;
}

/**
 * Bands / freshness / source / lightning are typed as plain strings on purpose: this screen
 * only *displays* them as chips, so we never branch on their exact values. 
 */
export interface RecommendationEvidence {
  observedWbgt: number | null;
  forecastWbgt30m: number | null;
  currentBand: string | null;
  forecastBand: string | null;
  observedAt: string | null;
  freshness: string | null;
  source: string | null;
  stationId: string | null;
  lightningState: string | null;
}

export type ApprovalDecision = "APPROVED" | "REJECTED" | "EDITED";

// Full parity with the backend Recommendation.RecommendationStatus enum and recommendation.yaml.
// SUPERSEDED = a newer auto-triggered draft replaced this one before a supervisor decided; the
// decision endpoint 409s. AUTO_DISPATCHED = a lightning-immediate stop-work skipped approval and was
// already sent to workers; the spec requires clients render it distinctly, with no approve/reject
// affordance. Narrowing this union to the two decidable states (as it once was) silently dropped both
// from the web queue — see ApprovalsPage.
export type RecommendationStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "SUPERSEDED"
  | "AUTO_DISPATCHED";

export interface ApprovalResponse {
  id: string;
  approverId: string;
  decision: ApprovalDecision;
  reason: string | null;
  editedMitigations: MitigationSuggestion[];
  decidedAt: string;
}

export interface Recommendation {
  id: string;
  shiftId: string;
  policyVersion: string | null;
  status: RecommendationStatus;
  rationale: string | null;
  createdAt: string;
  mitigations: MitigationSuggestion[];
  approval: ApprovalResponse | null;
  evidence: RecommendationEvidence | null;
  modelVersion: string | null;
}

/** Body for POST …/decision. `editedPlan` is required only when decision === "EDITED". */
export interface RecommendationDecisionRequest {
  decision: ApprovalDecision;
  reason?: string;
  editedPlan?: MitigationSuggestion[];
}

// One place builds the nested path, so a typo can't drift between the two calls below.
const recommendationsBase = (siteId: string, shiftId: string) =>
  `/api/v1/sites/${siteId}/shifts/${shiftId}/recommendations`;

export function fetchShiftRecommendations(siteId: string, shiftId: string): Promise<Recommendation[]> {
  return apiFetch<Recommendation[]>(recommendationsBase(siteId, shiftId));
}

/** Record a decision. Returns the updated recommendation (backend returns RecommendationResponse). */
export function decideRecommendation(
  siteId: string,
  shiftId: string,
  recommendationId: string,
  body: RecommendationDecisionRequest,
): Promise<Recommendation> {
  return apiFetch<Recommendation>(`${recommendationsBase(siteId, shiftId)}/${recommendationId}/decision`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * `POST …/shifts/{shiftId}/recommendations/generate` — ask the agent to draft a plan for this
 * shift. Mirrors the mobile app's `generateRecommendation` (SCRUM-118/289). Returns the created
 * recommendation, `PENDING_APPROVAL`, exactly as the list endpoint would.
 */
export function generateRecommendation(siteId: string, shiftId: string): Promise<Recommendation> {
  return apiFetch<Recommendation>(`${recommendationsBase(siteId, shiftId)}/generate`, {
    method: "POST",
  });
}
