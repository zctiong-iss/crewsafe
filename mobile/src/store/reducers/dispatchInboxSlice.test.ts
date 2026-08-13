/**
 * The inbox selectors (SCRUM-208).
 *
 * These decide the number on the Alerts badge, so a wrong answer here is a wrong count of
 * outstanding safety instructions. Each case below is a decision recorded in the plan rather
 * than an incidental behaviour, which is why they are asserted individually.
 *
 * @author Justin Chua
 */
const mockFetchPendingDispatches = jest.fn();
const mockAcknowledgeDispatch = jest.fn();
const mockCompleteDispatch = jest.fn();
jest.mock("@/api/endpoints/dispatch", () => ({
  fetchPendingDispatches: (...a: unknown[]) => mockFetchPendingDispatches(...a),
  acknowledgeDispatch: (...a: unknown[]) => mockAcknowledgeDispatch(...a),
  completeDispatch: (...a: unknown[]) => mockCompleteDispatch(...a),
}));

import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import reducer, {
  acknowledge,
  canSwipeDismiss,
  completeRest,
  dismissed,
  dismissFailure,
  idempotencyKeyAssigned,
  loadInbox,
  resetAcknowledgements,
  selectAllAcknowledged,
  selectUnacknowledgedCount,
  selectVisibleDispatches,
  type DispatchInboxState,
} from "./dispatchInboxSlice";
import { ApiError } from "@/api/errors";
import type { ActionDispatch } from "@/types/domain";
import type { RootState } from "../store";

function dispatchWith(id: string, dispatchedAt: string, actionCode = "HYDRATE"): ActionDispatch {
  return {
    id,
    approvalId: "a1",
    workerId: "w1",
    actionCode,
    instruction: null,
    startTime: null,
    endTime: null,
    status: "PENDING",
    dispatchedAt,
  };
}

const A = dispatchWith("a", "2026-08-05T10:00:00.000Z");
const B = dispatchWith("b", "2026-08-05T10:05:00.000Z");
const C = dispatchWith("c", "2026-08-05T10:10:00.000Z", "REST_15_MIN");

function stateWith(overrides: Partial<DispatchInboxState>): RootState {
  const base: DispatchInboxState = {
    status: "ready",
    pending: [],
    acknowledged: {},
    idempotencyKeys: {},
    inFlight: [],
    failures: {},
    dismissedIds: [],
    errorKey: null,
    requestId: null,
    refreshing: false,
    ...overrides,
  };
  return { dispatchInbox: base } as unknown as RootState;
}

function acknowledgementOf(dispatch: ActionDispatch, dismissAt: number | null = null) {
  return {
    acknowledgedAt: "2026-08-05T10:20:00.000Z",
    idempotencyKey: "key-" + dispatch.id,
    dispatch,
    dismissAt,
    hasRestTimer: false,
  };
}

describe("selectVisibleDispatches", () => {
  it("unions the server's pending rows with this device's acknowledgements", () => {
    // The server returns PENDING only, so an acknowledged action is absent from its answer —
    // the local record is the only thing keeping it on screen.
    const state = stateWith({ pending: [A], acknowledged: { b: acknowledgementOf(B) } });
    expect(selectVisibleDispatches(state).map((d) => d.id).sort()).toEqual(["a", "b"]);
  });

  it("de-duplicates a row that is in both, which happens on a slow refetch", () => {
    const state = stateWith({ pending: [A], acknowledged: { a: acknowledgementOf(A) } });
    expect(selectVisibleDispatches(state)).toHaveLength(1);
  });

  it("sorts newest first", () => {
    const state = stateWith({ pending: [A, C, B] });
    expect(selectVisibleDispatches(state).map((d) => d.id)).toEqual(["c", "b", "a"]);
  });

  /*
   * The ordering bug this guards against: acknowledgement records deliberately survive
   * dismissal, so the union puts a dismissed card back. Filtering has to happen after.
   */
  it("keeps a dismissed card hidden even though its acknowledgement survives", () => {
    const state = stateWith({
      pending: [],
      acknowledged: { a: acknowledgementOf(A) },
      dismissedIds: ["a"],
    });
    expect(selectVisibleDispatches(state)).toHaveLength(0);
  });

  it("hides a dismissed card that the server is still returning as pending", () => {
    const state = stateWith({ pending: [A], dismissedIds: ["a"] });
    expect(selectVisibleDispatches(state)).toHaveLength(0);
  });
});

describe("selectUnacknowledgedCount", () => {
  it("counts every visible row that has no acknowledgement", () => {
    expect(selectUnacknowledgedCount(stateWith({ pending: [A, B, C] }))).toBe(3);
  });

  it("drops by one for each acknowledgement", () => {
    const state = stateWith({ pending: [A, B], acknowledged: { c: acknowledgementOf(C) } });
    expect(selectUnacknowledgedCount(state)).toBe(2);
  });

  /*
   * The behaviour SCRUM-208 asked for by name: acknowledging a rest decrements immediately,
   * while its timer is still running. It falls out of "has an acknowledgement record" — there
   * is no special case, and adding one would be the way to break it.
   */
  it("stops counting a rest as soon as it is acknowledged, timer still running", () => {
    const future = Date.now() + 15 * 60_000;
    const state = stateWith({
      acknowledged: { c: { ...acknowledgementOf(C, future), hasRestTimer: true } },
    });
    expect(selectUnacknowledgedCount(state)).toBe(0);
  });

  it("still counts an in-flight acknowledgement, because the server has not confirmed", () => {
    // It stops counting when the server confirms, not when the button is pressed. The badge
    // must never report work the supervisor has not been told about.
    const state = stateWith({ pending: [A], inFlight: ["a"] });
    expect(selectUnacknowledgedCount(state)).toBe(1);
  });

  it("still counts a failed acknowledgement, because the action is still owed", () => {
    const state = stateWith({ pending: [A], failures: { a: "errors.network" } });
    expect(selectUnacknowledgedCount(state)).toBe(1);
  });

  it("does not count dismissed rows", () => {
    const state = stateWith({ pending: [A, B], dismissedIds: ["a"] });
    expect(selectUnacknowledgedCount(state)).toBe(1);
  });
});

describe("selectAllAcknowledged", () => {
  it("is true when everything on screen is acknowledged", () => {
    const state = stateWith({ acknowledged: { a: acknowledgementOf(A) } });
    expect(selectAllAcknowledged(state)).toBe(true);
  });

  it("is false while anything is outstanding", () => {
    const state = stateWith({ pending: [A], acknowledged: { b: acknowledgementOf(B) } });
    expect(selectAllAcknowledged(state)).toBe(false);
  });

  /*
   * "Nothing arrived" and "you dealt with everything" are different facts, and only the
   * second earns a tick on the icon. This is the assertion that keeps them apart.
   */
  it("is false for an empty list, which is not the same as being up to date", () => {
    expect(selectAllAcknowledged(stateWith({}))).toBe(false);
  });

  it("is false once the acknowledged cards have been dismissed and nothing remains", () => {
    const state = stateWith({ acknowledged: { a: acknowledgementOf(A) }, dismissedIds: ["a"] });
    expect(selectAllAcknowledged(state)).toBe(false);
  });
});

describe("dismissed", () => {
  it("records the id and drops the row from pending in the same step", () => {
    const before = stateWith({ pending: [A, B] }).dispatchInbox;
    const after = reducer(before, dismissed("a"));
    expect(after.dismissedIds).toEqual(["a"]);
    // Without this the card flickers back for one poll interval when a refetch that started
    // before the dismissal lands afterwards.
    expect(after.pending.map((d) => d.id)).toEqual(["b"]);
  });

  it("does not record the same id twice", () => {
    // A card can expire and be swiped in the same tick.
    const once = reducer(stateWith({ pending: [A] }).dispatchInbox, dismissed("a"));
    const twice = reducer(once, dismissed("a"));
    expect(twice.dismissedIds).toEqual(["a"]);
  });
});

describe("canSwipeDismiss", () => {
  const NOW = Date.parse("2026-08-05T10:30:00.000Z");

  function record(overrides: Partial<ReturnType<typeof acknowledgementOf>> = {}) {
    return { ...acknowledgementOf(A), ...overrides };
  }

  it("blocks a card that was never acknowledged", () => {
    // Still owed, and the supervisor has not been told.
    expect(canSwipeDismiss(undefined, false, NOW)).toBe(false);
  });

  it("blocks a card whose acknowledgement is still in flight", () => {
    expect(canSwipeDismiss(record(), true, NOW)).toBe(false);
  });

  it("allows an acknowledged card with no rest timer", () => {
    // The three-minute dwell is a confirmation lingering on screen; removing it early costs
    // nothing.
    expect(canSwipeDismiss(record({ hasRestTimer: false, dismissAt: NOW + 60_000 }), false, NOW)).toBe(
      true,
    );
  });

  /*
   * The SCRUM-207 regression, pinned.
   *
   * The countdown is not a dwell — it is the rest. Removing the card early removes the only
   * thing tracking a safety obligation, silently, against an acknowledgement already sent.
   */
  it("blocks an acknowledged rest whose timer is still running", () => {
    expect(canSwipeDismiss(record({ hasRestTimer: true, dismissAt: NOW + 60_000 }), false, NOW)).toBe(
      false,
    );
  });

  it("allows a rest whose deadline has passed", () => {
    // A deadline can lapse while the app is closed. The card auto-dismisses on mount, but
    // between mount and the timer firing it must not be stuck.
    expect(canSwipeDismiss(record({ hasRestTimer: true, dismissAt: NOW - 1 }), false, NOW)).toBe(
      true,
    );
  });

  it("allows a rest at the exact instant its deadline passes", () => {
    expect(canSwipeDismiss(record({ hasRestTimer: true, dismissAt: NOW }), false, NOW)).toBe(true);
  });

  it("allows a card flagged as a rest but carrying no deadline", () => {
    // Inconsistent state rather than a running rest: with no deadline nothing would ever
    // clear it, so leaving it unswipeable would strand it on the list forever.
    expect(canSwipeDismiss(record({ hasRestTimer: true, dismissAt: null }), false, NOW)).toBe(true);
  });
});

describe("loadInbox (SCRUM-352 / FR-004, FR-005)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the worker's pending dispatches", async () => {
    mockFetchPendingDispatches.mockResolvedValue([A]);
    const action = await loadInbox({ workerId: "w1" })(jest.fn(), () => ({}), undefined);
    expect(action.type).toBe(loadInbox.fulfilled.type);
    expect((action.payload as ActionDispatch[])[0].id).toBe("a");
  });

  it("maps an ApiError to its message key and request id", async () => {
    mockFetchPendingDispatches.mockRejectedValue(new ApiError("server", "HTTP 500", 500, "req-9"));
    const action = await loadInbox({ workerId: "w1" })(jest.fn(), () => ({}), undefined);
    expect(action.type).toBe(loadInbox.rejected.type);
    expect(action.payload).toEqual({ errorKey: "errors.server", requestId: "req-9" });
  });

  it("falls back to an unknown error for a non-API failure", async () => {
    mockFetchPendingDispatches.mockRejectedValue(new Error("boom"));
    const action = await loadInbox({ workerId: "w1" })(jest.fn(), () => ({}), undefined);
    expect(action.payload).toEqual({ errorKey: "errors.unknown", requestId: null });
  });

  it("shows loading, then ready with the fetched list", () => {
    const pending = reducer(undefined, { type: loadInbox.pending.type, meta: { arg: { workerId: "w1" } } });
    expect(pending.status).toBe("loading");

    const ready = reducer(pending, { type: loadInbox.fulfilled.type, payload: [A] });
    expect(ready.status).toBe("ready");
    expect(ready.pending).toEqual([A]);
  });

  it("keeps existing data visible on a background refresh rather than blanking it", () => {
    const ready = { ...reducer(undefined, { type: "@@INIT" }), status: "ready" as const, pending: [A] };
    const next = reducer(ready, {
      type: loadInbox.pending.type,
      meta: { arg: { workerId: "w1", refreshing: true } },
    });
    expect(next.status).toBe("ready");
    expect(next.refreshing).toBe(true);
  });

  it("surfaces the mapped error and request id when the load is rejected", () => {
    const next = reducer(undefined, {
      type: loadInbox.rejected.type,
      payload: { errorKey: "errors.network", requestId: "req-1" },
    });
    expect(next.status).toBe("error");
    expect(next.errorKey).toBe("errors.network");
    expect(next.requestId).toBe("req-1");
  });
});

describe("acknowledge (SCRUM-352 / FR-004, SCRUM-186)", () => {
  beforeEach(() => jest.clearAllMocks());

  function store(preloaded: Partial<DispatchInboxState> = {}) {
    const dispatchInboxState: DispatchInboxState = {
      status: "ready",
      pending: [],
      acknowledged: {},
      idempotencyKeys: {},
      inFlight: [],
      failures: {},
      dismissedIds: [],
      errorKey: null,
      requestId: null,
      refreshing: false,
      ...preloaded,
    };
    return configureStore({
      reducer: { dispatchInbox: reducer },
      preloadedState: { dispatchInbox: dispatchInboxState },
    });
  }

  // `acknowledge`'s thunk is generically typed against the full app RootState (it reads
  // `inFlight`/`acknowledged` via its `condition` guard), which this minimal single-slice
  // test store deliberately does not reproduce — cast at the one point that friction
  // surfaces, rather than assembling every unrelated slice just to satisfy the type.
  function dispatchAcknowledge(s: ReturnType<typeof store>, dispatchId: string) {
    return s.dispatch(acknowledge({ dispatchId }) as unknown as UnknownAction);
  }

  it("mints a new idempotency key on the first attempt and sends it", async () => {
    mockAcknowledgeDispatch.mockResolvedValue({ ...A, status: "ACKNOWLEDGED", startTime: null });
    const s = store({ pending: [A] });

    await dispatchAcknowledge(s, "a");

    expect(mockAcknowledgeDispatch).toHaveBeenCalledWith("a", expect.any(String));
    expect(s.getState().dispatchInbox.idempotencyKeys.a).toBeTruthy();
  });

  it("reuses the same key on a retry rather than minting a second one", async () => {
    mockAcknowledgeDispatch.mockResolvedValue({ ...A, status: "ACKNOWLEDGED", startTime: null });
    const s = store({ pending: [A], idempotencyKeys: { a: "existing-key-1" } });

    await dispatchAcknowledge(s, "a");

    expect(mockAcknowledgeDispatch).toHaveBeenCalledWith("a", "existing-key-1");
  });

  it("records the acknowledgement, with a rest timer, for a parseable rest code", async () => {
    mockAcknowledgeDispatch.mockResolvedValue({ ...C, status: "ACKNOWLEDGED", startTime: "2026-08-05T10:15:00.000Z" });
    const s = store({ pending: [C] });

    await dispatchAcknowledge(s, "c");

    const record = s.getState().dispatchInbox.acknowledged.c;
    expect(record.hasRestTimer).toBe(true);
    expect(record.dismissAt).not.toBeNull();
    // Dropped from pending immediately rather than waiting for a refetch.
    expect(s.getState().dispatchInbox.pending).toHaveLength(0);
  });

  it("records the acknowledgement without a rest timer for a non-rest action", async () => {
    mockAcknowledgeDispatch.mockResolvedValue({ ...A, status: "ACKNOWLEDGED", startTime: null });
    const s = store({ pending: [A] });

    await dispatchAcknowledge(s, "a");

    expect(s.getState().dispatchInbox.acknowledged.a.hasRestTimer).toBe(false);
  });

  it("refuses a second attempt while one is already in flight", async () => {
    mockAcknowledgeDispatch.mockResolvedValue({ ...A, status: "ACKNOWLEDGED", startTime: null });
    const s = store({ pending: [A], inFlight: ["a"] });

    await dispatchAcknowledge(s, "a");

    expect(mockAcknowledgeDispatch).not.toHaveBeenCalled();
  });

  it("refuses to re-acknowledge something already acknowledged", async () => {
    mockAcknowledgeDispatch.mockResolvedValue({ ...A, status: "ACKNOWLEDGED", startTime: null });
    const s = store({
      acknowledged: { a: { acknowledgedAt: "t", idempotencyKey: "k", dispatch: A, dismissAt: null, hasRestTimer: false } },
    });

    await dispatchAcknowledge(s, "a");

    expect(mockAcknowledgeDispatch).not.toHaveBeenCalled();
  });

  it("records a per-card failure, keyed so one failure does not hide the others", async () => {
    mockAcknowledgeDispatch.mockRejectedValue(new ApiError("network", "offline", null, null));
    const s = store({ pending: [A] });

    await dispatchAcknowledge(s, "a");

    expect(s.getState().dispatchInbox.failures.a).toBe("errors.network");
    expect(s.getState().dispatchInbox.inFlight).toEqual([]);
  });

  it("never lets a late rejection contradict an acknowledgement that already succeeded", () => {
    // The interleaving the condition guard makes rare, not impossible: a rejection landing
    // after a fulfilment must be dropped, or the card would read as both acknowledged and
    // failed at once.
    const already = {
      ...reducer(undefined, { type: "@@INIT" }),
      acknowledged: { a: { acknowledgedAt: "t", idempotencyKey: "k", dispatch: A, dismissAt: null, hasRestTimer: false } },
    };

    const next = reducer(already, {
      type: acknowledge.rejected.type,
      meta: { arg: { dispatchId: "a" } },
      payload: { dispatchId: "a", errorKey: "errors.network" },
    });

    expect(next.failures.a).toBeUndefined();
  });
});

describe("completeRest (SCRUM-352 / FR-005, US-11)", () => {
  it("swallows a failure rather than letting it stop the card from clearing", async () => {
    mockCompleteDispatch.mockRejectedValue(new Error("offline"));
    await expect(completeRest({ dispatchId: "c" })(jest.fn(), () => ({}), undefined)).resolves.not.toThrow();
  });
});

describe("other reducers", () => {
  it("idempotencyKeyAssigned records the key for that dispatch only", () => {
    const next = reducer(undefined, idempotencyKeyAssigned({ dispatchId: "a", idempotencyKey: "key-1" }));
    expect(next.idempotencyKeys.a).toBe("key-1");
  });

  it("dismissFailure clears just that card's failure", () => {
    const failed = { ...reducer(undefined, { type: "@@INIT" }), failures: { a: "errors.network", b: "errors.server" } };
    const next = reducer(failed, dismissFailure("a"));
    expect(next.failures).toEqual({ b: "errors.server" });
  });

  it("resetAcknowledgements clears the device-local acknowledgement state", () => {
    const populated = {
      ...reducer(undefined, { type: "@@INIT" }),
      acknowledged: { a: { acknowledgedAt: "t", idempotencyKey: "k", dispatch: A, dismissAt: null, hasRestTimer: false } },
      idempotencyKeys: { a: "k" },
      failures: { b: "errors.network" },
      dismissedIds: ["a"],
    };
    const next = reducer(populated, resetAcknowledgements());
    expect(next.acknowledged).toEqual({});
    expect(next.idempotencyKeys).toEqual({});
    expect(next.failures).toEqual({});
    expect(next.dismissedIds).toEqual([]);
  });
});

describe("device-local acknowledgements clear on sign-out (SCRUM-186)", () => {
  it.each(["auth/signOut/fulfilled", "auth/sessionExpired/fulfilled"])(
    "resets to initial state on %s",
    (actionType) => {
      const populated = {
        ...reducer(undefined, { type: "@@INIT" }),
        acknowledged: { a: { acknowledgedAt: "t", idempotencyKey: "k", dispatch: A, dismissAt: null, hasRestTimer: false } },
      };
      const next = reducer(populated, { type: actionType });
      // Belongs to the user who made it — leaving it would show the next worker on this
      // device someone else's completed actions.
      expect(next.acknowledged).toEqual({});
    },
  );
});
