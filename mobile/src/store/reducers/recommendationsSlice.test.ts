/**
 * How the recommendations slice behaves when one shift's read fails, and what a decision does to
 * what it holds (SCRUM-119).
 *
 * The load path is the interesting one. It fans out one request per shift, so a partial failure is
 * not hypothetical — a shift that moved site answers 403 while the rest answer fine. Blanking the
 * screen in that case would hide decisions the supervisor genuinely owes, which is worse than
 * showing three of four.
 *
 * @author Justin Chua
 */
const mockFetchShifts = jest.fn();
const mockFetchRecommendations = jest.fn();
const mockDecideRequest = jest.fn();

jest.mock("@/api/endpoints/shifts", () => ({ fetchShifts: (...a: unknown[]) => mockFetchShifts(...a) }));
jest.mock("@/api/endpoints/recommendations", () => ({
  fetchRecommendations: (...a: unknown[]) => mockFetchRecommendations(...a),
  decideRecommendation: (...a: unknown[]) => mockDecideRequest(...a),
}));

import reducer, { decideRecommendation, loadRecommendations } from "./recommendationsSlice";
import type { Recommendation } from "@/types/domain";

const SITE = "site-1";

function recommendation(id: string, createdAt: string, overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id,
    shiftId: "shift-1",
    policyVersion: "MOM-WBGT-2026.1",
    status: "PENDING_APPROVAL",
    rationale: "Forecast crosses the band",
    createdAt,
    mitigations: [],
    approval: null,
    ...overrides,
  };
}

/** Runs the thunk against a store stub and returns the fulfilled payload. */
async function runLoad() {
  const dispatch = jest.fn();
  const action = await loadRecommendations({ siteId: SITE })(dispatch, () => ({}), undefined);
  return action.payload as Recommendation[];
}

beforeEach(() => jest.clearAllMocks());

describe("loading", () => {
  it("collects recommendations across every shift, newest first", async () => {
    mockFetchShifts.mockResolvedValue([{ id: "shift-1" }, { id: "shift-2" }]);
    mockFetchRecommendations
      .mockResolvedValueOnce([recommendation("r-old", "2026-08-08T01:00:00Z")])
      .mockResolvedValueOnce([recommendation("r-new", "2026-08-08T05:00:00Z")]);

    const payload = await runLoad();

    expect(mockFetchRecommendations).toHaveBeenCalledTimes(2);
    // Newest first: the plan drafted against the most recent forecast is the one most likely to
    // still be worth acting on.
    expect(payload.map((item) => item.id)).toEqual(["r-new", "r-old"]);
  });

  it("keeps the shifts that answered when one shift fails", async () => {
    mockFetchShifts.mockResolvedValue([{ id: "shift-1" }, { id: "shift-2" }]);
    mockFetchRecommendations
      .mockRejectedValueOnce(new Error("403"))
      .mockResolvedValueOnce([recommendation("r-2", "2026-08-08T05:00:00Z")]);

    const payload = await runLoad();

    // The failure is absorbed, not surfaced: one unreadable shift must not cost the supervisor
    // sight of the decisions they can act on.
    expect(payload.map((item) => item.id)).toEqual(["r-2"]);
  });

  it("reports an error when the shift list itself cannot be read", async () => {
    // Nothing can be listed without it, so this one genuinely is the whole screen failing.
    mockFetchShifts.mockRejectedValue(new Error("offline"));

    const dispatch = jest.fn();
    const action = await loadRecommendations({ siteId: SITE })(dispatch, () => ({}), undefined);

    expect(action.type).toBe(loadRecommendations.rejected.type);
  });
});

describe("deciding", () => {
  it("replaces the recommendation with the server's answer", () => {
    const pending = recommendation("r-1", "2026-08-08T05:00:00Z");
    const state = { ...reducer(undefined, { type: "@@INIT" }), items: [pending] };

    const decided = recommendation("r-1", "2026-08-08T05:00:00Z", {
      status: "APPROVED",
      approval: {
        id: "ap-1",
        approverId: "sup-1",
        decision: "APPROVED",
        reason: null,
        editedMitigations: null,
        decidedAt: "2026-08-08T06:00:00Z",
      },
    });

    const next = reducer(state, { type: decideRecommendation.fulfilled.type, payload: decided });

    // Taken wholesale rather than patched: `decidedAt` is the server's clock, and a client that
    // invented one would put a time on the record that never happened.
    expect(next.items[0].approval?.decidedAt).toBe("2026-08-08T06:00:00Z");
    expect(next.decidingId).toBeNull();
  });

  it("releases the button when the decision is refused", () => {
    const busy = reducer(undefined, {
      type: decideRecommendation.pending.type,
      meta: { arg: { recommendationId: "r-1" } },
    });
    expect(busy.decidingId).toBe("r-1");

    // A 409 lands here. The screen explains it and reloads; the slice only has to stop the
    // spinner, or the supervisor is stranded on a screen that never settles.
    const next = reducer(busy, {
      type: decideRecommendation.rejected.type,
      payload: { errorKey: "errors.conflict" },
    });
    expect(next.decidingId).toBeNull();
  });
});
