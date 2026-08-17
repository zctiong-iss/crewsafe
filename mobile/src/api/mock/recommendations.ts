/**
 * Recommendations for `mock` auth mode (SCRUM-119).
 *
 * SCRUM-118 — the agent that drafts a recommendation — is not built, so *nothing* creates one
 * anywhere yet, in mock mode or against a real backend. These fixtures are what makes the
 * approve/edit/reject flow demonstrable and testable before that lands. They are shaped to the
 * contract `RecommendationController` already returns, not to an invented one, so the screen is
 * being built against the real thing.
 *
 * Every mitigation carries an `actionCode`, deliberately: a plan without one reaches the worker as
 * untranslated English, and a fixture that quietly modelled the degraded case would hide the very
 * behaviour the screen exists to get right.
 *
 * @author Justin Chua
 */
import { ApiError } from "../errors";
import { mockListShifts } from "./shifts";
import { DEMO_SITES } from "@/auth/demoUsers";
import type { DecisionInput } from "../endpoints/recommendations";
import { DETERMINISTIC_FALLBACK_MODEL } from "@/types/domain";
import type { Mitigation, Recommendation } from "@/types/domain";

let sequence = 0;
const nextId = (prefix: string) =>
  `${prefix}0000${(++sequence).toString(16)}-0000-4000-8000-00000000000${sequence.toString(16)}`;

/**
 * The four SCRUM-118 fields default to absent, so the base fixture is a mitigation drafted before
 * PR #205 — the shape the screen must still render correctly. Callers opt into the richer fields
 * one at a time, which is how the interesting cases get covered without a second factory.
 */
function mitigation(
  actionCode: Mitigation["actionCode"],
  category: Mitigation["category"],
  priority: string,
  action: string,
  rationale: string,
  estimatedImpact: string,
  extras: Partial<Pick<Mitigation, "origin" | "ruleReference" | "appliesTo" | "timing">> = {},
): Mitigation {
  return {
    priority,
    action,
    rationale,
    estimatedImpact,
    actionCode,
    category,
    origin: extras.origin ?? null,
    ruleReference: extras.ruleReference ?? null,
    // Null rather than [] — absent means the whole shift, and an empty array would say the
    // opposite: an action that applies to nobody.
    appliesTo: extras.appliesTo ?? null,
    timing: extras.timing ?? null,
  };
}

/**
 * Built lazily, on first read.
 *
 * Shift ids come from `mock/shifts`, which generates them at module load — so a recommendation
 * cannot name one until that module has finished initialising. Doing this at import time gave an
 * empty shift list and recommendations attached to nothing.
 */
let store: Recommendation[] | null = null;

function seed(): Recommendation[] {
  const shifts = mockListShifts(DEMO_SITES.bishan.id);
  const running = shifts.find((shift) => shift.status === "ACTIVE");
  const upcoming = shifts.find((shift) => shift.status === "PLANNED");

  const seeded: Recommendation[] = [];

  if (running) {
    seeded.push({
      id: nextId("r"),
      shiftId: running.id,
      policyVersion: "MOM-WBGT-2026.1",
      status: "PENDING_APPROVAL",
      rationale:
        "Forecast WBGT crosses into the 33 °C band within 30 minutes while three workers are on "
        + "heavy tasks, two of them still inside the acclimatisation window.",
      createdAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      mitigations: [
        mitigation(
          "REST_15_MIN_HOURLY",
          "REST",
          "HIGH",
          "Rest 15 minutes in shade every hour",
          "Forecast WBGT reaches 33.1 °C within 30 minutes on heavy tasks",
          "Keeps core temperature within MOM guidance",
          {
            // The case the screen has to get right: required by the policy engine, recurring,
            // and aimed at two named people rather than the whole crew.
            origin: "MANDATORY",
            ruleReference: "HS-33-HEAVY",
            appliesTo: running.assignments.slice(0, 2).map((a) => a.workerId),
            timing: { durationMinutes: 15, everyMinutes: 60, startByUtc: null },
          },
        ),
        mitigation(
          "HYDRATE_HOURLY",
          "HYDRATION",
          "HIGH",
          "Drink water at least once an hour",
          "Sustained sweat loss at this band and intensity",
          "Maintains hydration through the remainder of the shift",
          {
            // No appliesTo: this one is for everyone, and the screen must say so in words.
            origin: "MANDATORY",
            ruleReference: "HS-33-HYDRATE",
            timing: { durationMinutes: null, everyMinutes: 60, startByUtc: null },
          },
        ),
        mitigation(
          "RESCHEDULE_HEAVY_WORK",
          "WORK_SCHEDULING",
          "MEDIUM",
          "Move remaining heavy work to after 16:00",
          "Band is forecast to fall back below 32 °C by late afternoon",
          "Removes roughly two hours of peak-band heavy exposure",
          // ADVISORY and no rule reference: the agent's own suggestion on top of what the policy
          // engine requires, and the one a supervisor may legitimately drop.
          { origin: "ADVISORY" },
        ),
      ],
      approval: null,
      // A model wrote this one, so the screen shows no provenance notice.
      modelVersion: "anthropic.claude-3-5-sonnet",
    });
  }

  if (upcoming) {
    // A second pending item, so the list is not a one-row screen and the empty state is not the
    // only thing anyone ever sees in review.
    seeded.push({
      id: nextId("r"),
      shiftId: upcoming.id,
      policyVersion: "MOM-WBGT-2026.1",
      status: "PENDING_APPROVAL",
      rationale:
        "Tomorrow's forecast sits in the 32 °C band for the first four hours of the shift, with "
        + "no crew member past acclimatisation day 3.",
      createdAt: new Date(Date.now() - 90 * 60_000).toISOString(),
      mitigations: [
        mitigation(
          "REST_10_MIN_HOURLY",
          "REST",
          "MEDIUM",
          "Rest 10 minutes every hour for the first four hours",
          "32 °C band with an unacclimatised crew",
          "Halves early-shift heat accumulation",
        ),
        mitigation(
          "CLOSE_MONITORING",
          "MONITORING",
          "MEDIUM",
          "Watch the crew closely for heat illness",
          "No worker on this shift is past acclimatisation day 3",
          "Earlier detection of heat exhaustion",
        ),
      ],
      approval: null,
      /*
       * Deliberately the fallback, so the "no model wrote this" notice is reachable in review
       * without anyone having to break ml-service to see it. The real agent's no-LLM path is
       * the version most likely to reach a supervisor on a bad day.
       */
      modelVersion: DETERMINISTIC_FALLBACK_MODEL,
    });
  }

  return seeded;
}

function all(): Recommendation[] {
  store ??= seed();
  return store;
}

/** Deep-copied out, for the reason `mock/dispatch.ts` gives: Redux freezes what it receives. */
function copy(recommendation: Recommendation): Recommendation {
  return {
    ...recommendation,
    mitigations: recommendation.mitigations.map((m) => ({ ...m })),
    approval: recommendation.approval
      ? {
          ...recommendation.approval,
          editedMitigations:
            recommendation.approval.editedMitigations?.map((m) => ({ ...m })) ?? null,
        }
      : null,
  };
}

export function mockListRecommendations(shiftId: string): Recommendation[] {
  return all()
    .filter((recommendation) => recommendation.shiftId === shiftId)
    .map(copy);
}

/**
 * Mirrors the server's rules, in the server's order (SCRUM-119).
 *
 * The 409-before-validation ordering matters: deciding twice is a conflict regardless of whether
 * the second body was well-formed, and a mock that validated first would report the wrong error
 * for the case a supervisor is most likely to hit — two taps on a slow connection.
 */
export function mockDecideRecommendation(
  shiftId: string,
  recommendationId: string,
  input: DecisionInput,
): Recommendation {
  const found = all().find(
    (recommendation) => recommendation.id === recommendationId && recommendation.shiftId === shiftId,
  );
  if (!found) {
    throw new ApiError("not-found", "No such recommendation on this shift", 404, null);
  }
  if (found.approval) {
    throw new ApiError("conflict", "This recommendation already has a decision", 409, null);
  }
  if (input.decision === "REJECTED" && !input.reason?.trim()) {
    throw new ApiError("bad-request", "reason is required when decision is REJECTED", 400, null);
  }
  if (input.decision === "EDITED" && (input.editedPlan?.length ?? 0) === 0) {
    throw new ApiError("bad-request", "editedPlan is required when decision is EDITED", 400, null);
  }

  found.approval = {
    id: nextId("ap"),
    approverId: "supervisor-mock",
    decision: input.decision,
    reason: input.reason?.trim() ? input.reason.trim() : null,
    editedMitigations: input.decision === "EDITED" ? (input.editedPlan ?? []).map((m) => ({ ...m })) : null,
    decidedAt: new Date().toISOString(),
  };
  found.status = input.decision === "REJECTED" ? "REJECTED" : "APPROVED";

  return copy(found);
}

/** Test seam — lets a test start from a clean slate rather than inheriting another test's decision. */
export function resetMockRecommendations(): void {
  store = null;
  sequence = 0;
}

/**
 * Drafting a plan in mock mode (SCRUM-118).
 *
 * Deliberately produces a *mandatory* rest with timing and no `appliesTo` — the shape the real
 * agent's no-LLM fallback assembles straight from policy output, which is the version most likely
 * to reach a supervisor on a bad day and therefore the one worth being able to look at.
 */
export function mockGenerateRecommendation(shiftId: string): Recommendation {
  const created: Recommendation = {
    id: nextId("r"),
    shiftId,
    policyVersion: "MOM-WBGT-2026.1",
    status: "PENDING_APPROVAL",
    rationale:
      "Drafted on request. Current band requires an hourly rest for anyone on heavy work.",
    createdAt: new Date().toISOString(),
    // Mock mode never reaches ml-service, let alone Bedrock. Claiming a model id here would
    // make the one screen that reports provenance lie in the mode used for demos.
    modelVersion: DETERMINISTIC_FALLBACK_MODEL,
    mitigations: [
      mitigation(
        "REST_10_MIN_HOURLY",
        "REST",
        "HIGH",
        "Rest 10 minutes every hour",
        "Current band with heavy tasks on the shift",
        "Keeps core temperature within MOM guidance",
        {
          origin: "MANDATORY",
          ruleReference: "HS-32-HEAVY",
          timing: { durationMinutes: 10, everyMinutes: 60, startByUtc: null },
        },
      ),
    ],
    approval: null,
  };
  all().unshift(created);
  return copy(created);
}
