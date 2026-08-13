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
const mockGenerateRequest = jest.fn();

jest.mock("@/api/endpoints/shifts", () => ({ fetchShifts: (...a: unknown[]) => mockFetchShifts(...a) }));
jest.mock("@/api/endpoints/recommendations", () => ({
  fetchRecommendations: (...a: unknown[]) => mockFetchRecommendations(...a),
  decideRecommendation: (...a: unknown[]) => mockDecideRequest(...a),
  generateRecommendation: (...a: unknown[]) => mockGenerateRequest(...a),
}));

import { configureStore } from "@reduxjs/toolkit";
import reducer, {
  decideRecommendation,
  generateRecommendation,
  loadRecommendations,
} from "./recommendationsSlice";
import { ApiError } from "@/api/errors";
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

  it("shows loading, not a refresh spinner, on a first load", () => {
    const next = reducer(undefined, {
      type: loadRecommendations.pending.type,
      meta: { arg: { siteId: SITE } },
    });
    expect(next.status).toBe("loading");
    expect(next.refreshing).toBe(false);
  });

  it("shows a refresh spinner, not the loading state, on a pull-to-refresh", () => {
    const ready = { ...reducer(undefined, { type: "@@INIT" }), status: "ready" as const };
    const next = reducer(ready, {
      type: loadRecommendations.pending.type,
      meta: { arg: { siteId: SITE, refreshing: true } },
    });
    expect(next.status).toBe("ready");
    expect(next.refreshing).toBe(true);
  });

  it("replaces the list and clears any error once loaded", () => {
    const errored = { ...reducer(undefined, { type: "@@INIT" }), errorKey: "errors.network" };
    const loaded = [recommendation("r-1", "2026-08-08T05:00:00Z")];

    const next = reducer(errored, { type: loadRecommendations.fulfilled.type, payload: loaded });

    expect(next.status).toBe("ready");
    expect(next.items).toEqual(loaded);
    expect(next.errorKey).toBeNull();
  });

  it("surfaces the mapped error key when the load itself is rejected", () => {
    const next = reducer(undefined, {
      type: loadRecommendations.rejected.type,
      payload: { errorKey: "errors.network" },
    });
    expect(next.status).toBe("error");
    expect(next.errorKey).toBe("errors.network");
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

  it("maps an ApiError to its message key when the request itself fails", async () => {
    // Exercises the real thunk body, not just the reducer cases above — this is what
    // actually turns a rejected network call into the errorKey the screen reads.
    mockDecideRequest.mockRejectedValue(new ApiError("conflict", "HTTP 409", 409, "req-1"));
    const dispatch = jest.fn();

    const action = await decideRecommendation({
      siteId: SITE,
      shiftId: "shift-1",
      recommendationId: "r-1",
      input: { decision: "APPROVED" },
    })(dispatch, () => ({ recommendations: { decidingId: null } }), undefined);

    expect(action.type).toBe(decideRecommendation.rejected.type);
    expect((action.payload as { errorKey: string }).errorKey).toBe("errors.conflict");
  });

  it("refuses a second decision on the same recommendation while one is already in flight", async () => {
    // The client-side half of "one write path" — the guard exists so the supervisor is not
    // told their own second tap conflicted with itself.
    const store = configureStore({ reducer: { recommendations: reducer } });
    store.dispatch({
      type: decideRecommendation.pending.type,
      meta: { arg: { recommendationId: "r-1" } },
    });
    mockDecideRequest.mockResolvedValue({});

    await store.dispatch(
      decideRecommendation({
        siteId: SITE,
        shiftId: "shift-1",
        recommendationId: "r-1",
        input: { decision: "APPROVED" },
      }),
    );

    expect(mockDecideRequest).not.toHaveBeenCalled();
  });
});

describe("generating (SCRUM-118)", () => {
  it("prepends a newly drafted plan so the supervisor lands on what they asked for", () => {
    const drafted = recommendation("r-new", "2026-08-08T06:00:00Z");
    const state = { ...reducer(undefined, { type: "@@INIT" }), generating: true };

    const next = reducer(state, { type: generateRecommendation.fulfilled.type, payload: drafted });

    expect(next.generating).toBe(false);
    expect(next.items[0].id).toBe("r-new");
  });

  it("shows drafting in progress while pending", () => {
    const next = reducer(undefined, { type: generateRecommendation.pending.type });
    expect(next.generating).toBe(true);
    expect(next.errorKey).toBeNull();
  });

  it("releases the button, without inventing a plan, when drafting fails", () => {
    const busy = reducer(undefined, { type: generateRecommendation.pending.type });
    const next = reducer(busy, { type: generateRecommendation.rejected.type });
    expect(next.generating).toBe(false);
    expect(next.items).toEqual([]);
  });

  it("maps an ApiError to its message key when drafting itself fails", async () => {
    mockGenerateRequest.mockRejectedValue(new ApiError("server", "HTTP 500", 500, "req-1"));
    const dispatch = jest.fn();

    const action = await generateRecommendation({ siteId: SITE, shiftId: "shift-1" })(
      dispatch,
      () => ({ recommendations: { generating: false } }),
      undefined,
    );

    expect(action.type).toBe(generateRecommendation.rejected.type);
    expect((action.payload as { errorKey: string }).errorKey).toBe("errors.server");
  });

  it("refuses a second draft request while one is already generating", async () => {
    const store = configureStore({ reducer: { recommendations: reducer } });
    store.dispatch({ type: generateRecommendation.pending.type });
    mockGenerateRequest.mockResolvedValue(recommendation("r-x", "2026-08-08T07:00:00Z"));

    await store.dispatch(generateRecommendation({ siteId: SITE, shiftId: "shift-1" }));

    expect(mockGenerateRequest).not.toHaveBeenCalled();
  });
});

describe("site-scoped state clears on sign-out (SCRUM-119)", () => {
  it.each(["auth/signOut/fulfilled", "auth/sessionExpired/fulfilled"])(
    "resets to initial state on %s",
    (actionType) => {
      const populated = {
        ...reducer(undefined, { type: "@@INIT" }),
        items: [recommendation("r-1", "2026-08-08T05:00:00Z")],
        decidingId: "r-1",
      };

      const next = reducer(populated, { type: actionType });

      // Recommendations are per-site and sites are per-user; leaving them would show the
      // next person on this device decisions belonging to a crew they may have no access to.
      expect(next.items).toEqual([]);
      expect(next.decidingId).toBeNull();
    },
  );
});
