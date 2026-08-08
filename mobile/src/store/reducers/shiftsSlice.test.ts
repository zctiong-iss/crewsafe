/**
 * What the store does with the answers to a window change and a crew change (SCRUM-266).
 *
 * The three mutations resolve differently on purpose, and that is what is pinned here:
 * `editShiftWindow` and `addWorkerToShift` replace the shift with the server's copy, while
 * `removeWorkerFromShift` has no server copy to replace it with — a 204 carries no body — so it
 * drops the row locally. Getting that inverted would look like it worked and leave the screen
 * one refresh away from disagreeing with the backend.
 *
 * The single `staffingId` shared by add and remove is pinned too. It is what stops the two
 * racing, and it is the kind of field a later change would innocently split in two.
 *
 * @author Justin Chua
 */
import reducer, {
  addWorkerToShift,
  editShiftWindow,
  removeWorkerFromShift,
} from "./shiftsSlice";
import type { Shift } from "@/types/domain";

function shift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: "shift-1",
    siteId: "site-1",
    startsAt: "2026-08-08T00:00:00Z",
    endsAt: "2026-08-08T06:00:00Z",
    status: "PLANNED",
    assignments: [
      {
        id: "assign-1",
        workerId: "worker-1",
        taskName: "Kerb laying",
        intensity: "MODERATE",
        acclimatisationDay: 3,
      },
      {
        id: "assign-2",
        workerId: "worker-2",
        taskName: "Rebar tying",
        intensity: "HEAVY",
        acclimatisationDay: 6,
      },
    ],
    ...overrides,
  } as Shift;
}

/** The slice's own initial state, with one shift already loaded. */
function stateWithShift() {
  return reducer(undefined, { type: "@@INIT" }) as ReturnType<typeof reducer> & {
    shifts: Shift[];
  };
}

function loaded() {
  const base = stateWithShift();
  return { ...base, shifts: [shift()] };
}

describe("editShiftWindow", () => {
  it("replaces the shift with the server's copy rather than patching our own", () => {
    const moved = shift({ startsAt: "2026-08-08T02:00:00Z", endsAt: "2026-08-08T08:00:00Z" });

    const next = reducer(loaded(), { type: editShiftWindow.fulfilled.type, payload: moved });

    expect(next.shifts[0].startsAt).toBe("2026-08-08T02:00:00Z");
    expect(next.savingWindow).toBe(false);
  });

  it("releases the button when the server refuses", () => {
    const pending = reducer(loaded(), { type: editShiftWindow.pending.type });
    expect(pending.savingWindow).toBe(true);

    // The 400 for an ended shift lands here. The message is an Alert at the call site, so the
    // slice only has to stop the spinner — leaving it running would strand the sheet.
    const next = reducer(pending, {
      type: editShiftWindow.rejected.type,
      payload: { errorKey: "errors.badRequest" },
    });
    expect(next.savingWindow).toBe(false);
  });
});

describe("staffing a shift", () => {
  it("marks an add with the 'add' sentinel and a removal with the assignment id", () => {
    const adding = reducer(loaded(), { type: addWorkerToShift.pending.type });
    expect(adding.staffingId).toBe("add");

    const removing = reducer(loaded(), {
      type: removeWorkerFromShift.pending.type,
      meta: { arg: { assignmentId: "assign-2" } },
    });
    expect(removing.staffingId).toBe("assign-2");
  });

  it("takes the server's shift on an add", () => {
    const staffed = shift({
      assignments: [
        ...shift().assignments,
        {
          id: "assign-3",
          workerId: "worker-3",
          taskName: "Formwork",
          intensity: "LIGHT",
          acclimatisationDay: null,
        },
      ],
    });

    const next = reducer(loaded(), { type: addWorkerToShift.fulfilled.type, payload: staffed });

    expect(next.shifts[0].assignments).toHaveLength(3);
    expect(next.staffingId).toBeNull();
  });

  it("drops the assignment locally on a remove, because 204 carries no body", () => {
    const next = reducer(loaded(), {
      type: removeWorkerFromShift.fulfilled.type,
      payload: { shiftId: "shift-1", assignmentId: "assign-1" },
    });

    expect(next.shifts[0].assignments.map((a) => a.id)).toEqual(["assign-2"]);
    expect(next.staffingId).toBeNull();
  });

  it("leaves the crew alone when a removal fails", () => {
    // The worker is still on the shift as far as the server is concerned, so removing the row
    // optimistically would show a supervisor a crew that does not exist.
    const next = reducer(loaded(), {
      type: removeWorkerFromShift.rejected.type,
      payload: { errorKey: "errors.unknown" },
    });

    expect(next.shifts[0].assignments).toHaveLength(2);
    expect(next.staffingId).toBeNull();
  });
});
