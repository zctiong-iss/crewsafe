/**
 * Every site a safety manager oversees, and the plans drafted for each (SCRUM-TBD-90).
 *
 * ── WHY A SLICE OF ITS OWN, AND NOT `recommendationsSlice` ──────────────────────────────
 * That slice holds ONE site's plans in a flat `items` array, because a supervisor works a
 * site at a time and the Plans tab is scoped to whichever site is selected. A safety manager
 * is the opposite shape: many sites at once, none of them "current". Widening `items` to be
 * multi-site would have changed the meaning of every existing selector on the supervisor's
 * screens for the benefit of a screen they never open.
 *
 * ── PLANS ARE KEYED BY SITE AND LOADED LAZILY ───────────────────────────────────────────
 * Loading one site's plans costs one `fetchShifts` plus one `fetchRecommendations` PER SHIFT.
 * A manager on twenty sites with five shifts each is roughly 120 requests to open a screen,
 * on a phone, outdoors. So nothing is fetched until a site is expanded, and each site carries
 * its own status: one site failing must leave the other nineteen readable, which is the same
 * reasoning `recommendationsSlice` already applies with `Promise.allSettled` across shifts.
 *
 * Once loaded, a site's plans are kept. Collapsing a row is a display change, not a reason to
 * throw away work the manager already waited for.
 *
 * @author Justin Chua
 */
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import { fetchAccessibleSites } from "@/api/endpoints/sites";
import { fetchShifts } from "@/api/endpoints/shifts";
import { fetchRecommendations } from "@/api/endpoints/recommendations";
import { isApiError, messageKeyFor, type ApiError } from "@/api/errors";
import type { Recommendation, Site } from "@/types/domain";

/** Same mapping the other slices use, so an error reads identically wherever it surfaces. */
function keyFor(error: unknown): string {
  return isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
}

/** What is known about one site's plans. Absent entirely until the site is first expanded. */
export interface SitePlans {
  status: "loading" | "ready" | "error";
  items: Recommendation[];
  errorKey: string | null;
}

export interface OversightState {
  status: "idle" | "loading" | "ready" | "error";
  sites: Site[];
  errorKey: string | null;
  refreshing: boolean;
  /** Keyed by site id. A missing key means "never expanded", not "no plans". */
  plansBySite: Record<string, SitePlans>;
}

const initialState: OversightState = {
  status: "idle",
  sites: [],
  errorKey: null,
  refreshing: false,
  plansBySite: {},
};

/** The sites this manager oversees. Cheap — one request, no per-site work. */
export const loadOversightSites = createAsyncThunk<
  Site[],
  { siteIds: string[]; refreshing?: boolean },
  { rejectValue: { errorKey: string } }
>("oversight/loadSites", async ({ siteIds }, { rejectWithValue }) => {
  try {
    return await fetchAccessibleSites(siteIds);
  } catch (error) {
    return rejectWithValue({ errorKey: keyFor(error) });
  }
});

/**
 * One site's plans, fetched on expand.
 *
 * `Promise.allSettled` rather than `all`, copied from `recommendationsSlice` for the same
 * reason: one shift 403-ing because it moved site must not blank a manager's whole view of
 * that site. The failed shift simply contributes nothing.
 */
export const loadSitePlans = createAsyncThunk<
  { siteId: string; items: Recommendation[] },
  { siteId: string },
  { rejectValue: { siteId: string; errorKey: string } }
>("oversight/loadSitePlans", async ({ siteId }, { rejectWithValue }) => {
  try {
    const shifts = await fetchShifts(siteId);
    const results = await Promise.allSettled(
      shifts.map((shift) => fetchRecommendations(siteId, shift.id)),
    );

    const items = results
      .filter((r): r is PromiseFulfilledResult<Recommendation[]> => r.status === "fulfilled")
      .flatMap((r) => r.value);

    return { siteId, items };
  } catch (error) {
    return rejectWithValue({ siteId, errorKey: keyFor(error) });
  }
});

/** A plan nobody has decided on yet — what the collapsed row counts. */
export function awaitingDecisionCount(plans: SitePlans | undefined): number {
  if (!plans) return 0;
  return plans.items.filter((item) => item.status === "PENDING_APPROVAL").length;
}

const oversightSlice = createSlice({
  name: "oversight",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadOversightSites.pending, (state, action) => {
        if (action.meta.arg.refreshing) state.refreshing = true;
        else if (state.status !== "ready") state.status = "loading";
        state.errorKey = null;
      })
      .addCase(loadOversightSites.fulfilled, (state, action) => {
        state.status = "ready";
        state.refreshing = false;
        state.sites = action.payload;
      })
      .addCase(loadOversightSites.rejected, (state, action) => {
        state.status = "error";
        state.refreshing = false;
        state.errorKey = action.payload?.errorKey ?? "errors.unknown";
      })

      /*
       * Per-site status, deliberately. A single shared `loading` flag would make every row
       * spin while one site fetched, which is both wrong and slow-looking on a screen whose
       * whole point is showing twenty sites at once.
       */
      .addCase(loadSitePlans.pending, (state, action) => {
        const { siteId } = action.meta.arg;
        state.plansBySite[siteId] = {
          status: "loading",
          items: state.plansBySite[siteId]?.items ?? [],
          errorKey: null,
        };
      })
      .addCase(loadSitePlans.fulfilled, (state, action) => {
        state.plansBySite[action.payload.siteId] = {
          status: "ready",
          items: action.payload.items,
          errorKey: null,
        };
      })
      .addCase(loadSitePlans.rejected, (state, action) => {
        const siteId = action.payload?.siteId ?? action.meta.arg.siteId;
        state.plansBySite[siteId] = {
          status: "error",
          items: state.plansBySite[siteId]?.items ?? [],
          errorKey: action.payload?.errorKey ?? "errors.unknown",
        };
      });
  },
});

export default oversightSlice.reducer;
