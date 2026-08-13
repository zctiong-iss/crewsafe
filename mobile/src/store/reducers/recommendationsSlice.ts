/**
 * AI-drafted recommendations awaiting a supervisor's decision (SCRUM-119 / US-09).
 *
 * ── WHY THIS LOADS PER SHIFT AND COLLECTS THE RESULTS ───────────────────────────────────
 * The endpoint is scoped to one shift (`/sites/{siteId}/shifts/{shiftId}/recommendations`),
 * because a recommendation is *about* a shift. But the question a supervisor actually has is
 * "what am I holding up?", which spans every shift they run — so this loads the site's shifts
 * first and then fans out one request per shift.
 *
 * That is N+1 by construction and it is a deliberate, temporary trade: at demo scale N is single
 * digits, and the alternative is a new site-scoped list endpoint on someone else's module in a
 * ticket that is meant to be mobile-only. If a site ever runs enough concurrent shifts for this
 * to hurt, the fix is server-side (`GET /sites/{siteId}/recommendations?status=PENDING_APPROVAL`),
 * not a cache here.
 *
 * ── A DECISION IS NOT A DRAFT ───────────────────────────────────────────────────────────
 * There is no "undecide". The server refuses a second decision with 409 and this slice does not
 * pretend otherwise: a 409 is surfaced to the user as what it is, and the recommendation is
 * reloaded so they can see the decision that already exists.
 *
 * @author Justin Chua
 */
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import {
  decideRecommendation as decideRequest,
  fetchRecommendations,
  generateRecommendation as generateRequest,
  type DecisionInput,
} from "@/api/endpoints/recommendations";
import { fetchShifts } from "@/api/endpoints/shifts";
import { isApiError, messageKeyFor, type ApiError } from "@/api/errors";
import type { Recommendation } from "@/types/domain";

export type RecommendationsStatus = "idle" | "loading" | "ready" | "error";

export interface RecommendationsState {
  status: RecommendationsStatus;
  /** Every recommendation across the site's shifts, most recently drafted first. */
  items: Recommendation[];
  errorKey: string | null;
  refreshing: boolean;
  /** Recommendation id currently being decided, so only that screen shows a spinner. */
  decidingId: string | null;
  /** True while the agent is drafting a plan on request (SCRUM-118). */
  generating: boolean;
}

const initialState: RecommendationsState = {
  status: "idle",
  items: [],
  errorKey: null,
  refreshing: false,
  decidingId: null,
  generating: false,
};

export const loadRecommendations = createAsyncThunk<
  Recommendation[],
  { siteId: string; refreshing?: boolean },
  { rejectValue: { errorKey: string } }
>("recommendations/load", async ({ siteId }, { rejectWithValue }) => {
  try {
    const shifts = await fetchShifts(siteId);

    /*
     * Settled, not `all`. One shift failing — a 403 on a shift that moved site, a transient 500 —
     * must not blank the whole screen: a supervisor with four pending decisions should still see
     * the three that loaded rather than an error page. The failed one simply does not appear,
     * which is the same thing the list would show if it had no recommendations.
     */
    const results = await Promise.allSettled(
      shifts.map((shift) => fetchRecommendations(siteId, shift.id)),
    );

    return results
      .filter((result): result is PromiseFulfilledResult<Recommendation[]> => result.status === "fulfilled")
      .flatMap((result) => result.value)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
});

/**
 * `POST …/{recommendationId}/decision` — the one write path in US-09.
 *
 * Guarded on `decidingId`, and here the guard is doing real work rather than tidying: the second
 * of two taps would be answered 409 by the server, and the supervisor would be told their own
 * decision conflicted with itself.
 */
export const decideRecommendation = createAsyncThunk<
  Recommendation,
  { siteId: string; shiftId: string; recommendationId: string; input: DecisionInput },
  { rejectValue: { errorKey: string } }
>("recommendations/decide", async ({ siteId, shiftId, recommendationId, input }, { rejectWithValue }) => {
  try {
    return await decideRequest(siteId, shiftId, recommendationId, input);
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
}, {
  condition: ({ recommendationId }, { getState }) =>
    (getState() as { recommendations: RecommendationsState }).recommendations.decidingId
      !== recommendationId,
});

/**
 * Asks the agent for a plan (SCRUM-118 / US-08).
 *
 * Guarded on `generating`, and the guard is not cosmetic: drafting is expensive on the server and
 * a second request would produce a second recommendation for the same shift, leaving a supervisor
 * with two plans to decide on where they asked for one.
 */
export const generateRecommendation = createAsyncThunk<
  Recommendation,
  { siteId: string; shiftId: string },
  { rejectValue: { errorKey: string } }
>("recommendations/generate", async ({ siteId, shiftId }, { rejectWithValue }) => {
  try {
    return await generateRequest(siteId, shiftId);
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
}, {
  condition: (_arg, { getState }) =>
    !(getState() as { recommendations: RecommendationsState }).recommendations.generating,
});

const recommendationsSlice = createSlice({
  name: "recommendations",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadRecommendations.pending, (state, action) => {
        if (action.meta.arg.refreshing) state.refreshing = true;
        else if (state.status !== "ready") state.status = "loading";
        state.errorKey = null;
      })
      .addCase(loadRecommendations.fulfilled, (state, action) => {
        state.status = "ready";
        state.refreshing = false;
        state.items = action.payload;
        state.errorKey = null;
      })
      .addCase(loadRecommendations.rejected, (state, action) => {
        state.status = "error";
        state.refreshing = false;
        state.errorKey = action.payload?.errorKey ?? "errors.unknown";
      })

      .addCase(generateRecommendation.pending, (state) => {
        state.generating = true;
        state.errorKey = null;
      })
      .addCase(generateRecommendation.fulfilled, (state, action) => {
        state.generating = false;
        // Prepended: the plan just drafted is the newest, and the list is newest first. Inserting
        // locally means the supervisor lands on a list already showing what they asked for.
        state.items = [action.payload, ...state.items];
      })
      // Reported by the caller, which knows whether a failure means the agent timed out or the
      // endpoint is not there yet. The slice only releases the button.
      .addCase(generateRecommendation.rejected, (state) => {
        state.generating = false;
      })

      .addCase(decideRecommendation.pending, (state, action) => {
        state.decidingId = action.meta.arg.recommendationId;
        state.errorKey = null;
      })
      .addCase(decideRecommendation.fulfilled, (state, action) => {
        state.decidingId = null;
        // Replaced wholesale from the server's answer, which carries the approval the server
        // actually recorded — including `decidedAt`, which this app must not invent.
        const index = state.items.findIndex((item) => item.id === action.payload.id);
        if (index !== -1) state.items[index] = action.payload;
      })
      .addCase(decideRecommendation.rejected, (state) => {
        // Reported by the caller, which knows whether it was a 409 worth explaining or a network
        // blip worth retrying. The slice only releases the button.
        state.decidingId = null;
      })

      // Recommendations are site-scoped and sites are per-user. Leaving them would show the next
      // person decisions belonging to a crew they may have no access to.
      .addMatcher(
        (action) =>
          action.type === "auth/signOut/fulfilled" ||
          action.type === "auth/sessionExpired/fulfilled",
        () => initialState,
      );
  },
});

export default recommendationsSlice.reducer;
