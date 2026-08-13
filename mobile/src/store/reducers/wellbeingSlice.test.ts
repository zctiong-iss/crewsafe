/**
 * What the wellbeing slice guarantees on both sides of US-11.
 *
 * The ordering test is the one that matters most. A supervisor opens the Concerns tab to find out
 * what nobody has looked at yet; if an acknowledged concern can hold the top of the list because
 * it happened to be raised most recently, the screen answers a question nobody asked.
 *
 * @author Justin Chua
 */
const mockLogRequest = jest.fn();
const mockRaiseRequest = jest.fn();
const mockFetchCrewWellbeing = jest.fn();
const mockFetchSiteConcerns = jest.fn();
const mockAcknowledgeRequest = jest.fn();
jest.mock("@/api/endpoints/wellbeing", () => ({
  logWellbeing: (...a: unknown[]) => mockLogRequest(...a),
  raiseConcern: (...a: unknown[]) => mockRaiseRequest(...a),
  fetchCrewWellbeing: (...a: unknown[]) => mockFetchCrewWellbeing(...a),
  fetchSiteConcerns: (...a: unknown[]) => mockFetchSiteConcerns(...a),
  acknowledgeConcern: (...a: unknown[]) => mockAcknowledgeRequest(...a),
}));

import { configureStore } from "@reduxjs/toolkit";
import reducer, {
  acknowledgeConcern,
  loadConcerns,
  loadCrewWellbeing,
  logWellbeing,
  raiseConcern,
  selectOpenConcernCount,
  type WellbeingState,
} from "./wellbeingSlice";
import { ApiError } from "@/api/errors";
import type { Concern } from "@/types/domain";

function concern(id: string, raisedAt: string, status: Concern["status"] = "OPEN"): Concern {
  return {
    id,
    shiftId: "shift-1",
    workerId: "worker-1",
    symptoms: ["DIZZINESS"],
    note: null,
    status,
    raisedAt,
    acknowledgedAt: status === "ACKNOWLEDGED" ? "2026-08-11T06:00:00Z" : null,
  };
}

const initial = () => reducer(undefined, { type: "@@INIT" });

describe("logging", () => {
  it("remembers the server's timestamp, not the device's", () => {
    const busy = reducer(initial(), {
      type: logWellbeing.pending.type,
      meta: { arg: { logType: "REST" } },
    });
    expect(busy.loggingType).toBe("REST");

    const next = reducer(busy, {
      type: logWellbeing.fulfilled.type,
      payload: { id: "l-1", shiftId: "shift-1", logType: "REST", source: "SELF", loggedAt: "2026-08-11T02:40:00Z" },
    });

    // A phone with a wrong clock must not tell its owner they rested at a time their supervisor
    // will never see.
    expect(next.justLogged.REST).toBe("2026-08-11T02:40:00Z");
    expect(next.loggingType).toBeNull();
  });

  it("releases the button and reports when a log fails", () => {
    const busy = reducer(initial(), {
      type: logWellbeing.pending.type,
      meta: { arg: { logType: "HYDRATION" } },
    });

    const next = reducer(busy, {
      type: logWellbeing.rejected.type,
      payload: { errorKey: "errors.network" },
    });

    expect(next.loggingType).toBeNull();
    // Surfaced inline on the card so the worker can retry on the spot.
    expect(next.errorKey).toBe("errors.network");
    expect(next.justLogged.HYDRATION).toBeUndefined();
  });
});

describe("concern ordering", () => {
  it("puts unseen concerns above handled ones, newest first within each", () => {
    const next = reducer(initial(), {
      type: loadConcerns.fulfilled.type,
      payload: [
        concern("old-open", "2026-08-11T01:00:00Z"),
        concern("recent-ack", "2026-08-11T05:00:00Z", "ACKNOWLEDGED"),
        concern("new-open", "2026-08-11T04:00:00Z"),
      ],
    });

    // The acknowledged one is the most recent, and still sorts last: "needs a look" outranks
    // "happened recently".
    expect(next.concerns.map((c) => c.id)).toEqual(["new-open", "old-open", "recent-ack"]);
  });

  it("re-sorts after an acknowledgement so the handled one drops down", () => {
    const loaded = reducer(initial(), {
      type: loadConcerns.fulfilled.type,
      payload: [concern("a", "2026-08-11T05:00:00Z"), concern("b", "2026-08-11T04:00:00Z")],
    });
    expect(loaded.concerns[0].id).toBe("a");

    const next = reducer(loaded, {
      type: acknowledgeConcern.fulfilled.type,
      payload: concern("a", "2026-08-11T05:00:00Z", "ACKNOWLEDGED"),
    });

    expect(next.concerns.map((c) => c.id)).toEqual(["b", "a"]);
    expect(next.acknowledgingId).toBeNull();
  });

  it("shows loading, then surfaces the mapped error when the concern list fails to load", async () => {
    const pending = reducer(initial(), {
      type: loadConcerns.pending.type,
      meta: { arg: { siteId: "site-1" } },
    });
    expect(pending.status).toBe("loading");

    mockFetchSiteConcerns.mockRejectedValue(new ApiError("server", "HTTP 500", 500, "req-1"));
    const action = await loadConcerns({ siteId: "site-1" })(jest.fn(), () => ({}), undefined);
    expect(action.type).toBe(loadConcerns.rejected.type);

    const failed = reducer(pending, { type: action.type, payload: action.payload });
    expect(failed.status).toBe("error");
    expect(failed.errorKey).toBe("errors.server");
  });

  it("counts only what nobody has looked at", () => {
    const loaded = reducer(initial(), {
      type: loadConcerns.fulfilled.type,
      payload: [
        concern("a", "2026-08-11T05:00:00Z"),
        concern("b", "2026-08-11T04:00:00Z", "ACKNOWLEDGED"),
        concern("c", "2026-08-11T03:00:00Z"),
      ],
    });

    // The badge exists to say "these need you". Counting handled ones would make it permanent.
    expect(selectOpenConcernCount({ wellbeing: loaded })).toBe(2);
  });
});

describe("crew view", () => {
  it("empties the crew summary rather than failing the screen", () => {
    const loaded = { ...initial(), crew: [{ workerId: "w-1", lastRestAt: null, lastRestSource: null, lastHydrationAt: null, restCount: 0, hydrationCount: 0 }] };

    const next = reducer(loaded, { type: "wellbeing/loadCrew/rejected", payload: { errorKey: "errors.server" } });

    // The shift screen stays usable: a missing wellbeing summary is not a reason to blank the
    // crew, the window and the edit controls beside it.
    expect(next.crew).toEqual([]);
    expect(next.status).not.toBe("error");
  });

  it("populates the crew summary once loaded, without touching the screen-level error", () => {
    const crew = [{ workerId: "w-1", lastRestAt: null, lastRestSource: null, lastHydrationAt: null, restCount: 0, hydrationCount: 0 }];
    const next = reducer(initial(), { type: loadCrewWellbeing.fulfilled.type, payload: crew });
    expect(next.crew).toEqual(crew);
  });

  it("maps an ApiError from the real thunk body when the crew summary fails to load", async () => {
    mockFetchCrewWellbeing.mockRejectedValue(new ApiError("network", "offline", null, null));
    const action = await loadCrewWellbeing({ siteId: "site-1", shiftId: "shift-1" })(
      jest.fn(),
      () => ({}),
      undefined,
    );
    expect(action.type).toBe(loadCrewWellbeing.rejected.type);
    expect((action.payload as { errorKey: string }).errorKey).toBe("errors.network");
  });
});

describe("worker: logging and raising a concern (SCRUM-352 / FR-005, US-11)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("maps an ApiError from the real thunk body to its message key", async () => {
    mockLogRequest.mockRejectedValue(new ApiError("server", "HTTP 500", 500, "req-1"));
    const action = await logWellbeing({ shiftId: "shift-1", logType: "REST" })(
      jest.fn(),
      () => ({ wellbeing: { loggingType: null } }),
      undefined,
    );
    expect(action.type).toBe(logWellbeing.rejected.type);
    expect((action.payload as { errorKey: string }).errorKey).toBe("errors.server");
  });

  it("refuses a second log of the same kind while one is already in flight", async () => {
    const store = configureStore({ reducer: { wellbeing: reducer } });
    store.dispatch({ type: logWellbeing.pending.type, meta: { arg: { logType: "REST" } } });
    mockLogRequest.mockResolvedValue({ id: "l1", shiftId: "s1", logType: "REST", source: "SELF", loggedAt: "t" });

    await store.dispatch(logWellbeing({ shiftId: "shift-1", logType: "REST" }));

    expect(mockLogRequest).not.toHaveBeenCalled();
  });

  it("shows raising in progress, and clears it on success", () => {
    const busy = reducer(initial(), { type: raiseConcern.pending.type });
    expect(busy.raisingConcern).toBe(true);
    expect(busy.errorKey).toBeNull();

    const next = reducer(busy, { type: raiseConcern.fulfilled.type });
    expect(next.raisingConcern).toBe(false);
  });

  it("releases raising and reports the error when it fails", () => {
    const busy = reducer(initial(), { type: raiseConcern.pending.type });
    const next = reducer(busy, {
      type: raiseConcern.rejected.type,
      payload: { errorKey: "errors.network" },
    });
    expect(next.raisingConcern).toBe(false);
    expect(next.errorKey).toBe("errors.network");
  });

  it("refuses a second concern submission while one is already sending", async () => {
    const store = configureStore({ reducer: { wellbeing: reducer } });
    store.dispatch({ type: raiseConcern.pending.type });
    mockRaiseRequest.mockResolvedValue({ id: "c1" });

    await store.dispatch(raiseConcern({ shiftId: "shift-1", input: { symptoms: ["DIZZINESS"] } }));

    expect(mockRaiseRequest).not.toHaveBeenCalled();
  });

  it("maps an ApiError from the real thunk body when raising a concern fails", async () => {
    mockRaiseRequest.mockRejectedValue(new ApiError("bad-request", "HTTP 400", 400, "req-1"));
    const action = await raiseConcern({ shiftId: "shift-1", input: { symptoms: [] } })(
      jest.fn(),
      () => ({ wellbeing: { raisingConcern: false } }),
      undefined,
    );
    expect(action.type).toBe(raiseConcern.rejected.type);
    expect((action.payload as { errorKey: string }).errorKey).toBe("errors.bad-request");
  });
});

describe("supervisor: acknowledging a concern", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows which concern is being acknowledged", () => {
    const next = reducer(initial(), {
      type: acknowledgeConcern.pending.type,
      meta: { arg: { concernId: "c-1" } },
    });
    expect(next.acknowledgingId).toBe("c-1");
  });

  it("releases the spinner when acknowledgement is refused", () => {
    const busy = reducer(initial(), {
      type: acknowledgeConcern.pending.type,
      meta: { arg: { concernId: "c-1" } },
    });
    const next = reducer(busy, { type: acknowledgeConcern.rejected.type });
    expect(next.acknowledgingId).toBeNull();
  });

  it("refuses a second acknowledgement of the same concern already in flight", async () => {
    const store = configureStore({ reducer: { wellbeing: reducer } });
    store.dispatch({ type: acknowledgeConcern.pending.type, meta: { arg: { concernId: "c-1" } } });
    mockAcknowledgeRequest.mockResolvedValue(concern("c-1", "2026-08-11T05:00:00Z", "ACKNOWLEDGED"));

    await store.dispatch(acknowledgeConcern({ siteId: "site-1", concernId: "c-1" }));

    expect(mockAcknowledgeRequest).not.toHaveBeenCalled();
  });

  it("maps an ApiError from the real thunk body when acknowledgement itself fails", async () => {
    mockAcknowledgeRequest.mockRejectedValue(new ApiError("conflict", "HTTP 409", 409, "req-1"));
    const action = await acknowledgeConcern({ siteId: "site-1", concernId: "c-1" })(
      jest.fn(),
      () => ({ wellbeing: { acknowledgingId: null } }),
      undefined,
    );
    expect(action.type).toBe(acknowledgeConcern.rejected.type);
    expect((action.payload as { errorKey: string }).errorKey).toBe("errors.conflict");
  });
});

describe("wellbeing state clears on sign-out (US-11)", () => {
  it.each(["auth/signOut/fulfilled", "auth/sessionExpired/fulfilled"])(
    "resets to initial state on %s",
    (actionType) => {
      const populated: WellbeingState = {
        ...initial(),
        concerns: [concern("a", "2026-08-11T05:00:00Z")],
        justLogged: { REST: "2026-08-11T02:00:00Z" },
      };
      const next = reducer(populated, { type: actionType });
      // Per-person and per-site — leaving it would show the next person on a shared phone a
      // crew, or a log history, they may have no access to.
      expect(next.concerns).toEqual([]);
      expect(next.justLogged).toEqual({});
    },
  );
});
