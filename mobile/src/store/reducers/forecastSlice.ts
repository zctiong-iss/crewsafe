/**
 * Trained-model WBGT forecasts for a site, at 30 and 60 minutes (SCRUM-364 / US-06).
 *
 * ── WHY THE TWO HORIZONS ARE HELD SEPARATELY ────────────────────────────────────────────
 * They are two requests to a model that can decline either one independently, and the
 * supervisor's question — "is it worth moving the crew now?" — is still answerable with one
 * of them. Collapsing both into a single status would mean a 60-minute refusal erased a
 * perfectly good 30-minute prediction, which is the opposite of the trade a safety screen
 * should make.
 *
 * ── WHY `unavailable` IS NOT `error` ────────────────────────────────────────────────────
 * `SiteForecastService` refuses to predict on seven conditions: no recent weather, no WBGT on
 * the latest row, fewer than two rows, a missing station id, SIMULATED or STALE quality, a
 * station change inside the two-hour window, and any spacing off the exact 15-minute cadence.
 * On a quiet site, a demo build, or after one missed ingestion tick, a refusal is the *normal*
 * answer. Filing it under `error` would put a red banner over a weather screen that is working
 * correctly — and a banner that cries wolf is worse than no banner, because the next one is
 * ignored too.
 *
 * So `unavailable` never sets `errorKey`. The distinction is made once, in
 * `api/endpoints/forecast.ts`, and preserved here.
 *
 * Not persisted, for the reason `weatherSlice` gives about readings generally: a prediction
 * has a validity window, and rehydrating a stale one as though it were current is exactly the
 * failure §7.1 warns about. A forecast is worse than a reading in this respect — it was
 * already about the future when it was made.
 *
 * @author Justin Chua
 */
import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import {
  fetchSiteForecast,
  isForecastUnavailable,
} from "@/api/endpoints/forecast";
import { isApiError, messageKeyFor, type ApiError } from "@/api/errors";
import type { ForecastHorizonMinutes, SiteForecast } from "@/types/domain";

export type ForecastStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

/** The horizons the screen shows, and the only ones `ForecastController` accepts. */
export const FORECAST_HORIZONS: ForecastHorizonMinutes[] = [30, 60];

export interface HorizonState {
  status: ForecastStatus;
  forecast: SiteForecast | null;
  /** Null whenever `status` is `unavailable` — declining is not an error to report. */
  errorKey: string | null;
  requestId: string | null;
}

export interface ForecastState {
  /** The site these forecasts describe. Changing it discards them rather than re-labelling. */
  siteId: string | null;
  horizons: Record<ForecastHorizonMinutes, HorizonState>;
  refreshing: boolean;
}

const idleHorizon: HorizonState = {
  status: "idle",
  forecast: null,
  errorKey: null,
  requestId: null,
};

const initialState: ForecastState = {
  siteId: null,
  horizons: { 30: { ...idleHorizon }, 60: { ...idleHorizon } },
  refreshing: false,
};

interface RejectPayload {
  /** True when the model declined (503) rather than failed. */
  unavailable: boolean;
  errorKey: string | null;
  requestId: string | null;
}

export const loadForecast = createAsyncThunk<
  SiteForecast,
  { siteId: string; horizonMinutes: ForecastHorizonMinutes; refreshing?: boolean },
  { rejectValue: RejectPayload }
>("forecast/load", async ({ siteId, horizonMinutes }, { rejectWithValue }) => {
  try {
    return await fetchSiteForecast(siteId, horizonMinutes);
  } catch (error) {
    /*
     * Order matters. A declined forecast is checked first and never reaches the ApiError
     * branch, so it cannot pick up an `errorKey` on the way past — which is what would put
     * it on screen as a failure.
     */
    if (isForecastUnavailable(error)) {
      return rejectWithValue({
        unavailable: true,
        errorKey: null,
        requestId: error.requestId,
      });
    }
    if (isApiError(error)) {
      const apiError = error as ApiError;
      return rejectWithValue({
        unavailable: false,
        errorKey: messageKeyFor(apiError),
        requestId: apiError.requestId,
      });
    }
    return rejectWithValue({ unavailable: false, errorKey: "errors.unknown", requestId: null });
  }
});

const forecastSlice = createSlice({
  name: "forecast",
  initialState,
  reducers: {
    /**
     * Point the slice at a site, discarding anything held for a different one.
     *
     * A forecast is site-specific and unlabelled once it is in the store, so keeping the old
     * values while the new site loads would show one site's prediction under another site's
     * name — the same race `weatherSlice` guards, with the same consequence.
     */
    forecastSiteChanged: (state, action: PayloadAction<string>) => {
      if (state.siteId === action.payload) return;
      state.siteId = action.payload;
      state.horizons = { 30: { ...idleHorizon }, 60: { ...idleHorizon } };
      state.refreshing = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadForecast.pending, (state, action) => {
        const horizon = state.horizons[action.meta.arg.horizonMinutes];
        if (action.meta.arg.refreshing) state.refreshing = true;
        // A background poll over an already-answered horizon changes nothing on screen —
        // same reasoning as `weatherSlice`, so an auto-refresh cannot flicker a spinner over
        // a number somebody is mid-way through reading.
        else if (horizon.status !== "ready") horizon.status = "loading";
        horizon.errorKey = null;
      })
      .addCase(loadForecast.fulfilled, (state, action) => {
        if (state.siteId !== null && action.meta.arg.siteId !== state.siteId) {
          state.refreshing = false;
          return;
        }
        state.refreshing = false;
        state.horizons[action.meta.arg.horizonMinutes] = {
          status: "ready",
          forecast: action.payload,
          errorKey: null,
          requestId: null,
        };
      })
      .addCase(loadForecast.rejected, (state, action) => {
        if (state.siteId !== null && action.meta.arg.siteId !== state.siteId) {
          state.refreshing = false;
          return;
        }
        state.refreshing = false;
        const declined = action.payload?.unavailable ?? false;
        state.horizons[action.meta.arg.horizonMinutes] = {
          status: declined ? "unavailable" : "error",
          // Dropped either way. A prediction the model has since declined to stand behind is
          // not something to keep showing because it is the last one we happen to hold.
          forecast: null,
          errorKey: declined ? null : (action.payload?.errorKey ?? "errors.unknown"),
          requestId: action.payload?.requestId ?? null,
        };
      })

      // Forecasts are site-scoped and sites are per-user; leaving them would show the next
      // person on this device a prediction for a crew they may have no access to.
      .addMatcher(
        (action) =>
          action.type === "auth/signOut/fulfilled" ||
          action.type === "auth/sessionExpired/fulfilled",
        () => initialState,
      );
  },
});

export const { forecastSiteChanged } = forecastSlice.actions;

export default forecastSlice.reducer;
