/**
 * The supervisor's shifts for a chosen site (SCRUM-161).
 *
 * Its own site selection, separate from `weatherSlice`. A supervisor checking conditions at
 * one site while planning shifts at another is an ordinary thing to do, and a single shared
 * "current site" would make the two screens fight. The cost is loading the site list twice;
 * that is a cheap, cached, membership-filtered call.
 *
 * Worker names live here too, keyed by id, because assignments carry only `workerId`. The
 * map is deliberately allowed to miss: `GET /workers` returns ACTIVE workers only, so an
 * assignment referencing someone since offboarded resolves to nothing and the detail view
 * has to cope. See `workerNameFor`.
 *
 * @author Justin Chua
 */
import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import {
  createShift as createShiftRequest,
  deleteShift as deleteShiftRequest,
  fetchShifts,
  fetchSiteWorkers,
  type ShiftAssignmentInput,
} from "@/api/endpoints/shifts";
import { fetchAccessibleSites } from "@/api/endpoints/sites";
import { isApiError, messageKeyFor, type ApiError } from "@/api/errors";
import {
  addAssignment as addAssignmentRequest,
  removeAssignment as removeAssignmentRequest,
  updateAssignment as updateAssignmentRequest,
  updateShift as updateShiftRequest,
} from "@/api/endpoints/shifts";
import type { Shift, Site, SiteWorker, Intensity } from "@/types/domain";

export type ShiftsStatus = "idle" | "loading" | "ready" | "error";

export interface ShiftsState {
  status: ShiftsStatus;
  sites: Site[];
  selectedSiteId: string | null;
  /** Server order — most recently created first. Never re-sorted client-side. */
  shifts: Shift[];
  workers: SiteWorker[];
  errorKey: string | null;
  requestId: string | null;
  refreshing: boolean;
  /**
   * Shift id currently being deleted, so only that row shows a spinner.
   *
   * There is deliberately no `deleteErrorKey` beside it: a failed delete is reported with a
   * native Alert at the call site, because the supervisor is mid-way through a destructive
   * flow and a message that can scroll below the fold is not an acceptable answer to
   * "did that work?".
   */
  deletingId: string | null;
  /** Assignment id currently being saved, so only that card shows a spinner (SCRUM-266). */
  savingAssignmentId: string | null;
  /** True while the shift's own window is being corrected (SCRUM-266). */
  savingWindow: boolean;
  /**
   * Assignment id currently being taken off the shift, or `"add"` while one is being put on
   * (SCRUM-266).
   *
   * One field for both because they are the same button in the supervisor's hands — the crew
   * is being changed — and because neither should run while the other is in flight: adding a
   * worker while a removal is still resolving would race two answers for the same shift, and
   * whichever landed second would win regardless of which was asked for first.
   */
  staffingId: string | null;
  /** True while a create is in flight, so the form's submit button can disable itself. */
  creating: boolean;
}

const initialState: ShiftsState = {
  status: "idle",
  sites: [],
  selectedSiteId: null,
  shifts: [],
  workers: [],
  errorKey: null,
  requestId: null,
  refreshing: false,
  deletingId: null,
  savingAssignmentId: null,
  savingWindow: false,
  staffingId: null,
  creating: false,
};

interface LoadedPayload {
  sites: Site[];
  selectedSiteId: string | null;
  shifts: Shift[];
  workers: SiteWorker[];
}

export const loadShifts = createAsyncThunk<
  LoadedPayload,
  { siteIds: string[]; siteId?: string; refreshing?: boolean },
  { rejectValue: { errorKey: string; requestId: string | null } }
>("shifts/load", async ({ siteIds, siteId }, { rejectWithValue }) => {
  try {
    const sites = await fetchAccessibleSites(siteIds);
    const target = siteId ?? sites[0]?.id ?? null;

    if (!target) {
      return { sites, selectedSiteId: null, shifts: [], workers: [] };
    }

    /*
     * Both together, and both allowed to matter.
     *
     * `Promise.all` rather than sequential because neither depends on the other. But note
     * the asymmetry in authorization: a WORKER may read `/shifts` and may not read
     * `/workers`, so on a worker's token this whole call fails with a 403 from the second
     * request even though the first would have succeeded. That is correct — this is a
     * supervisor screen and a worker should never reach it — and it is why the worker tab
     * set does not register it.
     */
    const [shifts, workers] = await Promise.all([
      fetchShifts(target),
      fetchSiteWorkers(target),
    ]);

    return { sites, selectedSiteId: target, shifts, workers };
  } catch (error) {
    if (isApiError(error)) {
      const apiError = error as ApiError;
      return rejectWithValue({ errorKey: messageKeyFor(apiError), requestId: apiError.requestId });
    }
    return rejectWithValue({ errorKey: "errors.unknown", requestId: null });
  }
});

export const removeShift = createAsyncThunk<
  string,
  { siteId: string; shiftId: string },
  { rejectValue: { errorKey: string } }
>("shifts/remove", async ({ siteId, shiftId }, { rejectWithValue }) => {
  try {
    await deleteShiftRequest(siteId, shiftId);
    return shiftId;
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
}, {
  /*
   * One delete at a time, and never one for a shift already gone.
   *
   * The button disables itself while `deletingId` is set, but that is a render away from
   * the tap — and here there is a second window the inbox does not have: the confirmation
   * Alert. Two taps before the first Alert appears produce two dialogs, and confirming both
   * would fire two DELETEs. The second returns 404 and the supervisor gets "That record
   * does not exist" for a delete that actually succeeded, which is a worse lie than no
   * message at all.
   *
   * Suppressed here rather than reported: a blocked duplicate is not a failure.
   */
  condition: ({ shiftId }, { getState }) => {
    const { deletingId, shifts } = (getState() as { shifts: ShiftsState }).shifts;
    if (deletingId !== null) return false;
    return shifts.some((shift) => shift.id === shiftId);
  },
});

/**
 * `POST /sites/{siteId}/shifts`.
 *
 * Guarded, and the reason is subtler than the delete case. There is no confirmation dialog
 * here, so it looked as though the button disabling itself on `creating` was enough — but
 * `handleSubmit` runs the yup resolver *asynchronously*, and `creating` is only set once
 * that resolves and the thunk dispatches. Two taps inside that window run validation twice
 * and dispatch twice.
 *
 * The consequence is worse than a double delete, which merely 404s: this would create two
 * identical shifts, and the supervisor would have to notice and remove one. Nothing on the
 * server prevents it — `createShift` has no idempotency key and no uniqueness constraint on
 * (site, times).
 */
/**
 * `PATCH /sites/{siteId}/shifts/{shiftId}/assignments/{assignmentId}` (SCRUM-266).
 *
 * Returns the whole updated shift rather than the one assignment, because the server does —
 * and replacing what we hold beats patching our own copy and hoping the two agree.
 *
 * Guarded like the others, for the reason the create thunk gives: the form resolves its
 * validation asynchronously, so `savingAssignmentId` is set a render *after* the tap. Two taps
 * inside that window would send two PATCHes. Here the second would succeed rather than 404,
 * which is harmless — but it also means the guard costs nothing to have.
 */
export const editAssignment = createAsyncThunk<
  Shift,
  {
    siteId: string;
    shiftId: string;
    assignmentId: string;
    taskName?: string;
    intensity: Intensity;
    acclimatisationDay?: number;
  },
  { rejectValue: { errorKey: string } }
>("shifts/editAssignment", async (
  { siteId, shiftId, assignmentId, taskName, intensity, acclimatisationDay },
  { rejectWithValue },
) => {
  try {
    return await updateAssignmentRequest(siteId, shiftId, assignmentId, {
      taskName,
      intensity,
      acclimatisationDay,
    });
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
}, {
  condition: ({ assignmentId }, { getState }) =>
    (getState() as { shifts: ShiftsState }).shifts.savingAssignmentId !== assignmentId,
});

/**
 * `PATCH /sites/{siteId}/shifts/{shiftId}` — corrects the window (SCRUM-266).
 *
 * The server refuses this once the shift has ended, and that 400 is surfaced rather than
 * swallowed: a supervisor who has just typed new times needs to be told they were not taken.
 */
export const editShiftWindow = createAsyncThunk<
  Shift,
  { siteId: string; shiftId: string; startsAt: string; endsAt: string },
  { rejectValue: { errorKey: string } }
>("shifts/editWindow", async ({ siteId, shiftId, startsAt, endsAt }, { rejectWithValue }) => {
  try {
    return await updateShiftRequest(siteId, shiftId, startsAt, endsAt);
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
}, {
  condition: (_arg, { getState }) => !(getState() as { shifts: ShiftsState }).shifts.savingWindow,
});

/**
 * `POST …/shifts/{shiftId}/assignments` — puts a worker on a shift already planned (SCRUM-266).
 *
 * Guarded, and here the guard earns its keep: the server rejects a double-booked worker with a
 * 400, but two taps of the same row send both requests before either answer arrives, and the
 * second would be refused for a booking the first had only just created. The supervisor would
 * be told the worker is already on an overlapping shift — true, and entirely their own doing a
 * fraction of a second earlier, which reads as a bug.
 */
export const addWorkerToShift = createAsyncThunk<
  Shift,
  { siteId: string; shiftId: string; assignment: ShiftAssignmentInput },
  { rejectValue: { errorKey: string } }
>("shifts/addWorker", async ({ siteId, shiftId, assignment }, { rejectWithValue }) => {
  try {
    return await addAssignmentRequest(siteId, shiftId, assignment);
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
}, {
  condition: (_arg, { getState }) =>
    (getState() as { shifts: ShiftsState }).shifts.staffingId === null,
});

/**
 * `DELETE …/shifts/{shiftId}/assignments/{assignmentId}` — takes one worker off (SCRUM-266).
 *
 * The server answers 204 with no body, so unlike every other mutation here there is nothing to
 * replace our copy with. The assignment is dropped locally instead: "this row is gone" is the
 * one outcome that cannot be misread, and re-fetching the shift to learn it would cost a round
 * trip to be told the same thing.
 */
export const removeWorkerFromShift = createAsyncThunk<
  { shiftId: string; assignmentId: string },
  { siteId: string; shiftId: string; assignmentId: string },
  { rejectValue: { errorKey: string } }
>("shifts/removeWorker", async ({ siteId, shiftId, assignmentId }, { rejectWithValue }) => {
  try {
    await removeAssignmentRequest(siteId, shiftId, assignmentId);
    return { shiftId, assignmentId };
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
}, {
  condition: (_arg, { getState }) =>
    (getState() as { shifts: ShiftsState }).shifts.staffingId === null,
});

export const createShift = createAsyncThunk<
  Shift,
  { siteId: string; startsAt: string; endsAt: string; assignments: ShiftAssignmentInput[] },
  { rejectValue: { errorKey: string; requestId: string | null } }
>("shifts/create", async ({ siteId, startsAt, endsAt, assignments }, { rejectWithValue }) => {
  try {
    return await createShiftRequest(siteId, startsAt, endsAt, assignments);
  } catch (error) {
    if (isApiError(error)) {
      const apiError = error as ApiError;
      return rejectWithValue({ errorKey: messageKeyFor(apiError), requestId: apiError.requestId });
    }
    return rejectWithValue({ errorKey: "errors.unknown", requestId: null });
  }
}, {
  condition: (_arg, { getState }) => !(getState() as { shifts: ShiftsState }).shifts.creating,
});

const shiftsSlice = createSlice({
  name: "shifts",
  initialState,
  reducers: {
    siteSelected: (state, action: PayloadAction<string>) => {
      state.selectedSiteId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadShifts.pending, (state, action) => {
        // A background poll that already has data leaves the list alone.
        if (action.meta.arg.refreshing) state.refreshing = true;
        else if (state.status !== "ready") state.status = "loading";
        state.errorKey = null;
      })
      .addCase(loadShifts.fulfilled, (state, action) => {
        /*
         * Drop a response for a site the user has since moved away from.
         *
         * Tapping site A then quickly site B starts two loads. Nothing guarantees they come
         * back in order, and without this the slower response wins: the picker would show B
         * selected while the list underneath was A's crew. On a screen used to plan who
         * works where, showing one site's shifts under another site's name is the kind of
         * wrong that gets acted on.
         *
         * `selectedSiteId === null` is the first load, where there is nothing to compare to
         * and the response is defining the default.
         */
        if (
          state.selectedSiteId !== null &&
          action.payload.selectedSiteId !== state.selectedSiteId
        ) {
          state.refreshing = false;
          return;
        }

        state.status = "ready";
        state.refreshing = false;
        state.sites = action.payload.sites;
        state.selectedSiteId = action.payload.selectedSiteId;
        state.shifts = action.payload.shifts;
        state.workers = action.payload.workers;
        state.errorKey = null;
        state.requestId = null;
      })
      .addCase(loadShifts.rejected, (state, action) => {
        state.status = "error";
        state.refreshing = false;
        state.errorKey = action.payload?.errorKey ?? "errors.unknown";
        state.requestId = action.payload?.requestId ?? null;
      })

      .addCase(editAssignment.pending, (state, action) => {
        state.savingAssignmentId = action.meta.arg.assignmentId;
        state.errorKey = null;
      })
      .addCase(editAssignment.fulfilled, (state, action) => {
        state.savingAssignmentId = null;
        // Replaced wholesale from the server's answer. Patching our own copy would leave two
        // versions of the truth one refresh apart.
        const index = state.shifts.findIndex((shift) => shift.id === action.payload.id);
        if (index !== -1) state.shifts[index] = action.payload;
      })
      .addCase(editAssignment.rejected, (state, action) => {
        state.savingAssignmentId = null;
        state.errorKey = action.payload?.errorKey ?? "errors.unknown";
      })
      .addCase(editShiftWindow.pending, (state) => {
        state.savingWindow = true;
        state.errorKey = null;
      })
      .addCase(editShiftWindow.fulfilled, (state, action) => {
        state.savingWindow = false;
        const index = state.shifts.findIndex((shift) => shift.id === action.payload.id);
        if (index !== -1) state.shifts[index] = action.payload;
      })
      // Reported by the caller, which has the form the times were typed into. The slice only
      // releases the button.
      .addCase(editShiftWindow.rejected, (state) => {
        state.savingWindow = false;
      })

      .addCase(addWorkerToShift.pending, (state) => {
        state.staffingId = "add";
      })
      .addCase(addWorkerToShift.fulfilled, (state, action) => {
        state.staffingId = null;
        const index = state.shifts.findIndex((shift) => shift.id === action.payload.id);
        if (index !== -1) state.shifts[index] = action.payload;
      })
      .addCase(addWorkerToShift.rejected, (state) => {
        state.staffingId = null;
      })

      .addCase(removeWorkerFromShift.pending, (state, action) => {
        state.staffingId = action.meta.arg.assignmentId;
      })
      .addCase(removeWorkerFromShift.fulfilled, (state, action) => {
        state.staffingId = null;
        const shift = state.shifts.find((item) => item.id === action.payload.shiftId);
        if (shift) {
          shift.assignments = shift.assignments.filter(
            (assignment) => assignment.id !== action.payload.assignmentId,
          );
        }
      })
      .addCase(removeWorkerFromShift.rejected, (state) => {
        state.staffingId = null;
      })

      .addCase(createShift.pending, (state) => {
        state.creating = true;
      })
      .addCase(createShift.fulfilled, (state, action) => {
        state.creating = false;
        // Prepended, not appended: the list is most-recently-created first, so a new shift
        // belongs at the top. Inserting locally means the supervisor lands back on a list
        // that already shows what they just made, rather than one that looks unchanged
        // until the next poll.
        state.shifts = [action.payload, ...state.shifts];
      })
      .addCase(createShift.rejected, (state) => {
        // The error is surfaced on the form itself, where the fields are. The slice only
        // releases the button.
        state.creating = false;
      })

      .addCase(removeShift.pending, (state, action) => {
        state.deletingId = action.meta.arg.shiftId;
      })
      .addCase(removeShift.fulfilled, (state, action) => {
        state.deletingId = null;
        // Removed locally rather than waiting for a refetch: the detail screen pops back to
        // a list that must not still be showing what was just deleted.
        state.shifts = state.shifts.filter((shift) => shift.id !== action.payload);
      })
      // The error itself is surfaced by the caller as an Alert; the slice only releases
      // the spinner.
      .addCase(removeShift.rejected, (state) => {
        state.deletingId = null;
      })

      // Shifts are site-scoped and sites are per-user. Leaving them would show the next
      // person a crew they may have no access to.
      .addMatcher(
        (action) =>
          action.type === "auth/signOut/fulfilled" ||
          action.type === "auth/sessionExpired/fulfilled",
        () => initialState,
      );
  },
});

export const { siteSelected } = shiftsSlice.actions;

export default shiftsSlice.reducer;
