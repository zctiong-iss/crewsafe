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

/* ── The mock's stand-in for the SCRUM-291 auto-trigger (SCRUM-TBD-70) ──────────────────── */

/**
 * The store is seeded once, so before SCRUM-TBD-70 the Plans tab polled every 60s in mock mode
 * and received byte-identical data forever. The auto-regenerating behaviour was invisible in
 * exactly the mode used for demos — a reviewer would watch the screen do nothing and reasonably
 * conclude it was not implemented.
 *
 * Time is advanced with fake timers rather than waited out: the cadence is deliberately matched
 * to the server's 2-minute default, and a test that slept for it would add two minutes to every
 * run to prove something a clock can prove instantly.
 */
describe("auto-trigger", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetMockRecommendations();
  });
  afterEach(() => jest.useRealTimers());

  function shiftId() {
    const shift = mockListShifts(DEMO_SITES.bishan.id).find((s) => s.status === "ACTIVE");
    if (!shift) throw new Error("fixture shift missing");
    return shift.id;
  }

  it("drafts nothing before the interval has elapsed", () => {
    const id = shiftId();
    const before = mockListRecommendations(id).length;

    jest.advanceTimersByTime(60_000); // half the cadence
    expect(mockListRecommendations(id)).toHaveLength(before);
  });

  it("drafts a new plan once the interval has elapsed", () => {
    const id = shiftId();
    const before = mockListRecommendations(id).length;

    jest.advanceTimersByTime(2 * 60_000);
    expect(mockListRecommendations(id)).toHaveLength(before + 1);
  });

  it("SUPERSEDES the open plan rather than stacking a second one", () => {
    /*
     * The contract most likely to be got wrong by a client, and the mock is where a client
     * learns it. `AgentDraftService.supersedeOpenRecommendation` flips the open plan to
     * SUPERSEDED before drafting, so there is never more than one awaiting a decision. A mock
     * that stacked would teach the opposite.
     */
    const id = shiftId();
    jest.advanceTimersByTime(2 * 60_000);

    const after = mockListRecommendations(id);
    expect(after.filter((r) => r.status === "PENDING_APPROVAL")).toHaveLength(1);
    expect(after.filter((r) => r.status === "SUPERSEDED")).toHaveLength(1);
  });

  it("marks the auto-drafted plan as written by no model", () => {
    // Mock mode reaches no ml-service and therefore no Bedrock. Claiming a model id would make
    // the provenance notice lie in the one mode where nobody can check.
    const id = shiftId();
    jest.advanceTimersByTime(2 * 60_000);

    const pending = mockListRecommendations(id).find((r) => r.status === "PENDING_APPROVAL");
    expect(pending?.modelVersion).toBe("deterministic-fallback");
  });

  it("drafts nothing for a shift with no open plan", () => {
    // The server only drafts for a shift in scope. Inventing plans for a shift nobody is
    // running would be the mock telling a story the backend does not.
    const planned = mockListShifts(DEMO_SITES.bishan.id).find((s) => s.status === "CLOSED");
    if (!planned) return; // no closed fixture; nothing to assert

    const before = mockListRecommendations(planned.id).length;
    jest.advanceTimersByTime(2 * 60_000);
    expect(mockListRecommendations(planned.id)).toHaveLength(before);
  });
});
