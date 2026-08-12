/**
 * The mock decision path has to refuse exactly what the server refuses (SCRUM-119).
 *
 * A mock that is more permissive than the backend is worse than no mock: the flow passes in demo
 * mode, ships, and fails the first time a real supervisor uses it. These cases mirror
 * `RecommendationService.decide` — including the order it checks in, because a supervisor who
 * double-taps needs to be told "already decided", not "reason required".
 *
 * @author Justin Chua
 */
import {
  mockDecideRecommendation,
  mockListRecommendations,
  resetMockRecommendations,
} from "./recommendations";
import { mockListShifts } from "./shifts";
import { DEMO_SITES } from "@/auth/demoUsers";
import { isApiError, type ApiError } from "../errors";

/** The seeded pending recommendation on the site's running shift. */
function firstPending() {
  const shift = mockListShifts(DEMO_SITES.bishan.id).find((s) => s.status === "ACTIVE");
  if (!shift) throw new Error("fixture shift missing");
  const [recommendation] = mockListRecommendations(shift.id);
  return { shiftId: shift.id, recommendation };
}

function statusOf(run: () => unknown): number | null {
  try {
    run();
    return null;
  } catch (error) {
    return isApiError(error) ? (error as ApiError).status : null;
  }
}

beforeEach(() => resetMockRecommendations());

it("seeds a pending recommendation with a translatable code on every mitigation", () => {
  const { recommendation } = firstPending();

  expect(recommendation.status).toBe("PENDING_APPROVAL");
  // A fixture mitigation without a code would model the degraded path and hide the behaviour the
  // screen exists to get right — the worker receiving their own language.
  expect(recommendation.mitigations.every((m) => m.actionCode !== null)).toBe(true);
});

it("records an approval and flips the status", () => {
  const { shiftId, recommendation } = firstPending();

  const decided = mockDecideRecommendation(shiftId, recommendation.id, { decision: "APPROVED" });

  expect(decided.status).toBe("APPROVED");
  expect(decided.approval?.decision).toBe("APPROVED");
  // The draft survives the decision — that is the "both versions retained" half of US-09.
  expect(decided.mitigations).toHaveLength(recommendation.mitigations.length);
});

it("keeps the draft and the edited plan side by side", () => {
  const { shiftId, recommendation } = firstPending();
  const kept = recommendation.mitigations.slice(0, 1);

  const decided = mockDecideRecommendation(shiftId, recommendation.id, {
    decision: "EDITED",
    editedPlan: kept,
  });

  expect(decided.approval?.editedMitigations).toHaveLength(1);
  expect(decided.mitigations.length).toBeGreaterThan(1);
});

it("refuses a rejection with no reason", () => {
  const { shiftId, recommendation } = firstPending();

  expect(statusOf(() => mockDecideRecommendation(shiftId, recommendation.id, { decision: "REJECTED" })))
    .toBe(400);
});

it("refuses an edit with an empty plan", () => {
  const { shiftId, recommendation } = firstPending();

  expect(statusOf(() =>
    mockDecideRecommendation(shiftId, recommendation.id, { decision: "EDITED", editedPlan: [] }),
  )).toBe(400);
});

it("answers 409 on a second decision, before it validates the body", () => {
  const { shiftId, recommendation } = firstPending();
  mockDecideRecommendation(shiftId, recommendation.id, { decision: "APPROVED" });

  // Deliberately a body that would also fail validation. The conflict is the true answer, and
  // reporting "reason required" here would send the supervisor to fix the wrong thing.
  expect(statusOf(() => mockDecideRecommendation(shiftId, recommendation.id, { decision: "REJECTED" })))
    .toBe(409);
});

it("answers 404 for a recommendation on another shift", () => {
  const { recommendation } = firstPending();

  expect(statusOf(() =>
    mockDecideRecommendation("some-other-shift", recommendation.id, { decision: "APPROVED" }),
  )).toBe(404);
});
