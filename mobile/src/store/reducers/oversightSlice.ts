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
import { fetchPlanSummary, type SitePlanSummary } from "@/api/endpoints/oversight";
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
  /**
   * Server-counted plans per site, keyed by site id — one request, fetched on mount.
   *
   * Separate from `plansBySite` because they answer different questions and arrive at different
   * times: this says how much is outstanding everywhere, before anything is expanded, and
   * `plansBySite` says what those plans actually are, once one site has been opened.
   *
   * Empty until the summary lands, which is why `awaitingDecisionCount` falls back to counting
   * whatever plans have been fetched rather than reporting a confident zero.
   */
  summaryBySite: Record<string, SitePlanSummary>;
}

const initialState: OversightState = {
  status: "idle",
  sites: [],
  errorKey: null,
  refreshing: false,
  plansBySite: {},
  summaryBySite: {},
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

/**
 * Counts across every site at once, so a collapsed row can still say what is waiting.
 *
 * Deliberately tolerant of failure: if the summary cannot be fetched the screen keeps working
 * with lazily-loaded counts, which is what it did before this existed. A badge is worth less
 * than the list it sits on.
 */
export const loadPlanSummary = createAsyncThunk<SitePlanSummary[], void>(
  "oversight/loadPlanSummary",
  async () => fetchPlanSummary(),
);

/**
 * A plan nobody has decided on yet — what the collapsed row counts.
 *
 * ── WHY THE SERVER COUNT WINS ───────────────────────────────────────────────────────────
 * This used to count `plans.items` alone, which meant a site nobody had expanded reported
 * zero — indistinguishable on screen from a site with genuinely nothing outstanding. A manager
 * scanning the list would pass over a site with a plan pending approval, on a screen whose
 * whole purpose is preventing that. The summary is fetched for every site on mount, so the
 * number is true before anyone touches anything.
 *
 * Fetched plans take precedence once they exist, because they are newer: expanding a site
 * re-reads it, and a manager who just watched a plan appear should not see a stale badge
 * disagree with the row directly beneath it.
 */
export function awaitingDecisionCount(
  plans: SitePlans | undefined,
  summary?: SitePlanSummary | undefined,
): number {
  if (plans?.status === "ready") {
    return plans.items.filter((item) => item.status === "PENDING_APPROVAL").length;
  }
  if (summary) return summary.awaitingDecision;
  // Neither has arrived. Zero is the only honest answer, and the badge stays hidden.
  return plans ? plans.items.filter((item) => item.status === "PENDING_APPROVAL").length : 0;
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
      /*
       * "loading" only when there is nothing to show yet.
       *
       * These plans now refresh on a timer, on focus and on resume, so a plain `status =
       * "loading"` would blank an expanded site and flash a spinner over readable content
       * every couple of minutes — the exact behaviour `useAutoRefresh` documents itself as
       * existing to avoid. A refresh over content already on screen is invisible until it
       * lands and the content changes.
       */
      .addCase(loadSitePlans.pending, (state, action) => {
        const { siteId } = action.meta.arg;
        const existing = state.plansBySite[siteId];
        state.plansBySite[siteId] = {
          status: existing?.items.length ? "ready" : "loading",
          items: existing?.items ?? [],
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
      /*
       * A failed refresh keeps the plans it already had rather than replacing them with an
       * error. Now that this polls, one dropped request on a site network would otherwise
       * swap a readable list for a banner and then swap it back two minutes later.
       *
       * The error still surfaces on a first load, which is the case where there is genuinely
       * nothing to show and silence would read as "this site has no plans".
       */
      .addCase(loadSitePlans.rejected, (state, action) => {
        const siteId = action.payload?.siteId ?? action.meta.arg.siteId;
        const existing = state.plansBySite[siteId];
        if (existing?.items.length) {
          state.plansBySite[siteId] = { ...existing, status: "ready", errorKey: null };
          return;
        }
        state.plansBySite[siteId] = {
          status: "error",
          items: [],
          errorKey: action.payload?.errorKey ?? "errors.unknown",
        };
      })

      /*
       * No `pending` or `rejected` case, and no errorKey. A failed summary must not raise a
       * banner over a working list: the counts are an aid to triage, and losing them degrades
       * the screen to exactly the behaviour it had before they existed. The site list, which
       * is the thing a manager actually came for, is unaffected either way.
       */
      .addCase(loadPlanSummary.fulfilled, (state, action) => {
        state.summaryBySite = Object.fromEntries(
          action.payload.map((summary) => [summary.siteId, summary]),
        );
      });
  },
});

export default oversightSlice.reducer;
