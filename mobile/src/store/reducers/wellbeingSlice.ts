/**
 * Rest, hydration and concerns — both sides of US-11 in one slice.
 *
 * ── WHY ONE SLICE FOR TWO ROLES ─────────────────────────────────────────────────────────
 * A worker writes logs and concerns; a supervisor reads them and acknowledges. They are the same
 * data seen from two ends, and splitting them would mean two slices holding the same concern in
 * two shapes. No session is ever both roles, so the fields for the other role simply stay empty.
 *
 * ── THE LOG BUTTONS MUST FEEL INSTANT ───────────────────────────────────────────────────
 * `justLogged` records what was logged and when, locally, the moment the server confirms. The
 * button uses it to say "logged at 10:42" rather than leaving a worker in gloves wondering
 * whether their tap registered. It is not the source of truth — the supervisor's view reads the
 * server — it is the acknowledgement the person tapping needs.
 *
 * @author Justin Chua
 */
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import {
  acknowledgeConcern as acknowledgeRequest,
  fetchCrewWellbeing,
  fetchSiteConcerns,
  logWellbeing as logRequest,
  raiseConcern as raiseRequest,
  type ConcernInput,
} from "@/api/endpoints/wellbeing";
import { isApiError, messageKeyFor, type ApiError } from "@/api/errors";
import type { Concern, CrewWellbeingRow, WellbeingLog, WellbeingLogType } from "@/types/domain";

export type WellbeingStatus = "idle" | "loading" | "ready" | "error";

export interface WellbeingState {
  /** Worker side: the last time each kind was logged on this device, for immediate feedback. */
  justLogged: Partial<Record<WellbeingLogType, string>>;
  /** Which kind is in flight, so only that button shows a spinner. */
  loggingType: WellbeingLogType | null;
  raisingConcern: boolean;

  /** Supervisor side. */
  crew: CrewWellbeingRow[];
  concerns: Concern[];
  status: WellbeingStatus;
  refreshing: boolean;
  acknowledgingId: string | null;
  errorKey: string | null;
}

const initialState: WellbeingState = {
  justLogged: {},
  loggingType: null,
  raisingConcern: false,
  crew: [],
  concerns: [],
  status: "idle",
  refreshing: false,
  acknowledgingId: null,
  errorKey: null,
};

/**
 * Guarded on `loggingType`: two taps of the same button in the same second are one rest, and the
 * server would faithfully record both. A worker double-tapping because the first tap seemed not
 * to register must not end up claiming two breaks they did not take.
 */
export const logWellbeing = createAsyncThunk<
  WellbeingLog,
  { shiftId: string; logType: WellbeingLogType },
  { rejectValue: { errorKey: string } }
>("wellbeing/log", async ({ shiftId, logType }, { rejectWithValue }) => {
  try {
    return await logRequest(shiftId, logType);
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
}, {
  condition: ({ logType }, { getState }) =>
    (getState() as { wellbeing: WellbeingState }).wellbeing.loggingType !== logType,
});

export const raiseConcern = createAsyncThunk<
  Concern,
  { shiftId: string; input: ConcernInput },
  { rejectValue: { errorKey: string } }
>("wellbeing/raiseConcern", async ({ shiftId, input }, { rejectWithValue }) => {
  try {
    return await raiseRequest(shiftId, input);
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
}, {
  condition: (_arg, { getState }) => !(getState() as { wellbeing: WellbeingState }).wellbeing.raisingConcern,
});

/** Supervisor: the crew's latest rest and drink on one shift. */
export const loadCrewWellbeing = createAsyncThunk<
  CrewWellbeingRow[],
  { siteId: string; shiftId: string },
  { rejectValue: { errorKey: string } }
>("wellbeing/loadCrew", async ({ siteId, shiftId }, { rejectWithValue }) => {
  try {
    return await fetchCrewWellbeing(siteId, shiftId);
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
});

export const loadConcerns = createAsyncThunk<
  Concern[],
  { siteId: string; refreshing?: boolean },
  { rejectValue: { errorKey: string } }
>("wellbeing/loadConcerns", async ({ siteId }, { rejectWithValue }) => {
  try {
    return await fetchSiteConcerns(siteId);
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
});

export const acknowledgeConcern = createAsyncThunk<
  Concern,
  { siteId: string; concernId: string },
  { rejectValue: { errorKey: string } }
>("wellbeing/acknowledgeConcern", async ({ siteId, concernId }, { rejectWithValue }) => {
  try {
    return await acknowledgeRequest(siteId, concernId);
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
}, {
  condition: ({ concernId }, { getState }) =>
    (getState() as { wellbeing: WellbeingState }).wellbeing.acknowledgingId !== concernId,
});

/** Open first, then newest first — an unseen concern outranks one somebody already handled. */
function ordered(concerns: Concern[]): Concern[] {
  return [...concerns].sort((a, b) => {
    if (a.status !== b.status) return a.status === "OPEN" ? -1 : 1;
    return b.raisedAt.localeCompare(a.raisedAt);
  });
}

const wellbeingSlice = createSlice({
  name: "wellbeing",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(logWellbeing.pending, (state, action) => {
        state.loggingType = action.meta.arg.logType;
        state.errorKey = null;
      })
      .addCase(logWellbeing.fulfilled, (state, action) => {
        state.loggingType = null;
        // The server's timestamp, not the device's. A phone with a wrong clock must not tell its
        // owner they rested at a time their supervisor will never see.
        state.justLogged[action.payload.logType] = action.payload.loggedAt;
      })
      .addCase(logWellbeing.rejected, (state, action) => {
        state.loggingType = null;
        state.errorKey = action.payload?.errorKey ?? "errors.unknown";
      })

      .addCase(raiseConcern.pending, (state) => {
        state.raisingConcern = true;
        state.errorKey = null;
      })
      .addCase(raiseConcern.fulfilled, (state) => {
        state.raisingConcern = false;
      })
      .addCase(raiseConcern.rejected, (state, action) => {
        state.raisingConcern = false;
        state.errorKey = action.payload?.errorKey ?? "errors.unknown";
      })

      .addCase(loadCrewWellbeing.fulfilled, (state, action) => {
        state.crew = action.payload;
      })
      // A crew summary that fails to load leaves the shift screen otherwise usable, so this
      // deliberately does not set the screen-level error.
      .addCase(loadCrewWellbeing.rejected, (state) => {
        state.crew = [];
      })

      .addCase(loadConcerns.pending, (state, action) => {
        if (action.meta.arg.refreshing) state.refreshing = true;
        else if (state.status !== "ready") state.status = "loading";
        state.errorKey = null;
      })
      .addCase(loadConcerns.fulfilled, (state, action) => {
        state.status = "ready";
        state.refreshing = false;
        state.concerns = ordered(action.payload);
      })
      .addCase(loadConcerns.rejected, (state, action) => {
        state.status = "error";
        state.refreshing = false;
        state.errorKey = action.payload?.errorKey ?? "errors.unknown";
      })

      .addCase(acknowledgeConcern.pending, (state, action) => {
        state.acknowledgingId = action.meta.arg.concernId;
      })
      .addCase(acknowledgeConcern.fulfilled, (state, action) => {
        state.acknowledgingId = null;
        const index = state.concerns.findIndex((concern) => concern.id === action.payload.id);
        if (index !== -1) state.concerns[index] = action.payload;
        // Re-sorted, so an acknowledged concern drops below the ones still waiting rather than
        // holding the top of the list because it happened to be raised most recently.
        state.concerns = ordered(state.concerns);
      })
      .addCase(acknowledgeConcern.rejected, (state) => {
        state.acknowledgingId = null;
      })

      // Wellbeing is per-person and per-site. Leaving it would show the next person to sign in
      // on a shared phone a crew they may have no access to.
      .addMatcher(
        (action) =>
          action.type === "auth/signOut/fulfilled" ||
          action.type === "auth/sessionExpired/fulfilled",
        () => initialState,
      );
  },
});

/** How many concerns nobody has looked at yet — the tab badge. */
export function selectOpenConcernCount(state: { wellbeing: WellbeingState }): number {
  return state.wellbeing.concerns.filter((concern) => concern.status === "OPEN").length;
}

export default wellbeingSlice.reducer;
