/**
 * The inbox selectors (SCRUM-208).
 *
 * These decide the number on the Alerts badge, so a wrong answer here is a wrong count of
 * outstanding safety instructions. Each case below is a decision recorded in the plan rather
 * than an incidental behaviour, which is why they are asserted individually.
 */
import reducer, {
  dismissed,
  selectAllAcknowledged,
  selectUnacknowledgedCount,
  selectVisibleDispatches,
  type DispatchInboxState,
} from "./dispatchInboxSlice";
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
