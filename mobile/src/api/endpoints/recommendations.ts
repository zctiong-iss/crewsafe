/**
 * The supervisor's recommendation-decision surface (SCRUM-119), against
 * `docs/api/recommendation.yaml`.
 *
 * All of this is REAL — `RecommendationController` implements every call here. Only `mock` auth
 * mode diverges, and only for want of a backend.
 *
 * Two authorization shapes, and they are deliberately different:
 *
 *   GET  …/recommendations           SUPERVISOR / SAFETY_MANAGER / ADMIN — oversight can read
 *   POST …/{id}/decision             SUPERVISOR / ADMIN only — oversight cannot decide
 *
 * That asymmetry is the whole point of US-09: a safety manager can see what was decided and what
 * changed, but the decision itself belongs to the supervisor who owns the crew.
 *
 * @author Justin Chua
 */
import { request } from "../client";
import { isMockApi } from "@/auth/authMode";
import {
  mockDecideRecommendation,
  mockGenerateRecommendation,
  mockListRecommendations,
} from "../mock/recommendations";
import type { ApprovalDecision, Mitigation, Recommendation } from "@/types/domain";

/** Simulates a round trip, so loading states are visible rather than theoretical. */
const MOCK_LATENCY_MS = 350;

function delay<T>(produce: () => T): Promise<T> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(produce());
      } catch (error) {
        reject(error);
      }
    }, MOCK_LATENCY_MS),
  );
}

/** `GET /api/v1/sites/{siteId}/shifts/{shiftId}/recommendations`. */
export function fetchRecommendations(siteId: string, shiftId: string): Promise<Recommendation[]> {
  if (isMockApi()) return delay(() => mockListRecommendations(shiftId));
  return request<Recommendation[]>({
    url: `/api/v1/sites/${siteId}/shifts/${shiftId}/recommendations`,
    method: "GET",
  });
}

/** The shape `RecommendationController.RationaleResponse` returns. */
export interface TranslatedRationale {
  recommendationId: string;
  text: string;
  locale: string;
  /** False means `text` is the stored English, not a translation. */
  translated: boolean;
}

/**
 * `GET …/recommendations/{recommendationId}/rationale?locale=xx`.
 *
 * A separate call rather than a field on the recommendation, deliberately. The list endpoint
 * returns every plan for a shift, so widening the response would fire a translation for plans
 * nobody opened — spending model calls on prose that is never read, on the path a supervisor
 * uses during a heat event.
 *
 * Only the model's own paragraph needs this. The summary above it is rebuilt from structured
 * evidence and is already translated offline, which is why this request never blocks a render.
 *
 * In mock mode there is no model and nothing to translate: the mock rationale is already
 * resolved through i18n, so this reports it as untranslated English rather than pretending.
 */
export function fetchRationale(
  siteId: string,
  shiftId: string,
  recommendationId: string,
  locale: string,
): Promise<TranslatedRationale> {
  if (isMockApi()) {
    return delay(() => ({
      recommendationId,
      text: "",
      locale,
      translated: false,
    }));
  }
  return request<TranslatedRationale>({
    url:
      `/api/v1/sites/${siteId}/shifts/${shiftId}/recommendations/${recommendationId}` +
      `/rationale?locale=${encodeURIComponent(locale)}`,
    method: "GET",
  });
}

export interface DecisionInput {
  decision: ApprovalDecision;
  /** Required by the server when the decision is REJECTED. */
  reason?: string;
  /** Required by the server when the decision is EDITED. The full final plan, not a delta. */
  editedPlan?: Mitigation[];
}

/**
 * `POST …/recommendations/{recommendationId}/decision`.
 *
 * Returns the whole updated recommendation — draft and approval together — so a caller replaces
 * what it holds rather than patching its own copy and hoping the two agree.
 *
 * Answers 409 when the recommendation already has a decision. That is not a race to paper over:
 * a decision is a record of what happened, and the second caller genuinely did lose. The screen
 * surfaces it rather than retrying.
 */
export function decideRecommendation(
  siteId: string,
  shiftId: string,
  recommendationId: string,
  input: DecisionInput,
): Promise<Recommendation> {
  if (isMockApi()) return delay(() => mockDecideRecommendation(shiftId, recommendationId, input));
  return request<Recommendation>({
    url: `/api/v1/sites/${siteId}/shifts/${shiftId}/recommendations/${recommendationId}/decision`,
    method: "POST",
    data: input,
  });
}

/**
 * `POST …/shifts/{shiftId}/recommendations/generate` — ask the agent for a plan (SCRUM-118).
 *
 * **This endpoint does not exist yet.** SCRUM-289 builds it, and until then the caller is hidden
 * behind `features.draftPlanTrigger`. Written now against the contract the design fixes rather
 * than later against whatever shape gets discovered: the alternative is a client written from
 * memory weeks after the decision was made.
 *
 * Returns the created recommendation, `PENDING_APPROVAL`, exactly as the list endpoint would.
 */
export function generateRecommendation(siteId: string, shiftId: string): Promise<Recommendation> {
  if (isMockApi()) return delay(() => mockGenerateRecommendation(shiftId));
  return request<Recommendation>({
    url: `/api/v1/sites/${siteId}/shifts/${shiftId}/recommendations/generate`,
    method: "POST",
  });
}
