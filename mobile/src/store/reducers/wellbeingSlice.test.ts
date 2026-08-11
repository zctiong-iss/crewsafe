/**
 * What the wellbeing slice guarantees on both sides of US-11.
 *
 * The ordering test is the one that matters most. A supervisor opens the Concerns tab to find out
 * what nobody has looked at yet; if an acknowledged concern can hold the top of the list because
 * it happened to be raised most recently, the screen answers a question nobody asked.
 *
 * @author Justin Chua
 */
import reducer, {
  acknowledgeConcern,
  loadConcerns,
  logWellbeing,
  selectOpenConcernCount,
} from "./wellbeingSlice";
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
});
