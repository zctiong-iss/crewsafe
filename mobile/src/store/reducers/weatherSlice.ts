/**
 * Conditions for a chosen site.
 *
 * Separate from `safetySlice` rather than merged with it, because the two answer different
 * questions. Safety is scoped to *the shift the worker is on* — one site, decided by the
 * server. Weather is scoped to *a site the user picked*, which for a safety manager with
 * two memberships is a genuine choice. Sharing one slice would mean the weather tab could
 * silently retarget the shift screen, or a supervisor with no shift would find safety state
 * that belongs to nobody.
 *
 * Not persisted, for the same reason as safety: a reading has a validity window, and
 * rehydrating a stale one as though it were current is the failure §7.1 warns about.
 */
import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { fetchSiteConditions } from "@/api/endpoints/safety";
import { fetchAccessibleSites } from "@/api/endpoints/sites";
import { isApiError, messageKeyFor, type ApiError } from "@/api/errors";
import type { PolicyEvaluation, Site, SiteConditions } from "@/types/domain";

export type WeatherStatus = "idle" | "loading" | "ready" | "error";

export interface WeatherState {
  status: WeatherStatus;
  sites: Site[];
  selectedSiteId: string | null;
  conditions: SiteConditions | null;
  /** Band only is used on this screen — see the thunk. */
  policy: PolicyEvaluation | null;
  errorKey: string | null;
  requestId: string | null;
  refreshing: boolean;
}

const initialState: WeatherState = {
  status: "idle",
  sites: [],
  selectedSiteId: null,
  conditions: null,
  policy: null,
  errorKey: null,
  requestId: null,
  refreshing: false,
};

interface LoadedPayload {
  sites: Site[];
  selectedSiteId: string | null;
  conditions: SiteConditions | null;
  policy: PolicyEvaluation | null;
}

export const loadWeather = createAsyncThunk<
  LoadedPayload,
  { workerId: string; siteIds: string[]; siteId?: string; refreshing?: boolean },
  { rejectValue: { errorKey: string; requestId: string | null } }
>("weather/load", async ({ workerId, siteIds, siteId }, { rejectWithValue }) => {
  try {
    const sites = await fetchAccessibleSites(siteIds);

    // Honour an explicit choice; otherwise the first site alphabetically. A user with no
    // memberships legitimately has none — that is an empty state, not an error.
    const target = siteId ?? sites[0]?.id ?? null;

    if (!target) {
      return { sites, selectedSiteId: null, conditions: null, policy: null };
    }

    /*
     * `MODERATE` is passed only because the mock evaluates policy locally and needs an
     * intensity to do it. This screen renders the *band*, which is a property of the WBGT
     * reading and does not depend on intensity — only the required actions do, and those
     * belong on the shift screen where the worker's real assignment is known. The real
     * endpoint derives intensity server-side from the caller's assignment anyway; a client
     * that could name its own would be choosing its own heat-rest obligation.
     */
    const response = await fetchSiteConditions(target, "MODERATE", workerId);

    return {
      sites,
      selectedSiteId: target,
      conditions: response.observation,
      policy: response.policy,
    };
  } catch (error) {
    if (isApiError(error)) {
      const apiError = error as ApiError;
      return rejectWithValue({ errorKey: messageKeyFor(apiError), requestId: apiError.requestId });
    }
    return rejectWithValue({ errorKey: "errors.unknown", requestId: null });
  }
});

const weatherSlice = createSlice({
  name: "weather",
  initialState,
  reducers: {
    siteSelected: (state, action: PayloadAction<string>) => {
      state.selectedSiteId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadWeather.pending, (state, action) => {
        /*
         * Three cases, distinguished without a third flag:
         *
         *   pull-to-refresh   the user asked, so show the control's spinner
         *   first load        nothing on screen yet, so show the loader
         *   background poll   already `ready`, so change nothing at all
         *
         * The last one is why `useAutoRefresh` can call this every five minutes without the
         * screen flickering a spinner over a reading somebody is mid-way through reading.
         */
        if (action.meta.arg.refreshing) state.refreshing = true;
        else if (state.status !== "ready") state.status = "loading";
        state.errorKey = null;
      })
      .addCase(loadWeather.fulfilled, (state, action) => {
        /*
         * Drop a response for a site the user has since moved away from.
         *
         * Same race as the shift list: tapping site A then quickly site B starts two loads
         * with no ordering guarantee, and the slower one would otherwise win — showing one
         * site's WBGT reading under another site's name. On a screen whose number decides
         * whether people keep working, that is not a cosmetic mismatch.
         *
         * `selectedSiteId === null` is the first load, where the response is defining the
         * default rather than answering a choice.
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
        state.conditions = action.payload.conditions;
        state.policy = action.payload.policy;
        state.errorKey = null;
        state.requestId = null;
      })
      .addCase(loadWeather.rejected, (state, action) => {
        state.status = "error";
        state.refreshing = false;
        state.errorKey = action.payload?.errorKey ?? "errors.unknown";
        state.requestId = action.payload?.requestId ?? null;
      })

      // Site membership is per-user. Leaving this would show the next person conditions for
      // a site they may have no access to.
      .addMatcher(
        (action) =>
          action.type === "auth/signOut/fulfilled" ||
          action.type === "auth/sessionExpired/fulfilled",
        () => initialState,
      );
  },
});

export const { siteSelected } = weatherSlice.actions;

export default weatherSlice.reducer;
