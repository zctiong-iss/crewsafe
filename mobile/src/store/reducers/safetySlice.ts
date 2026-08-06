/**
 * Everything the worker's shift screen shows: their shift, the lightning risk over their
 * site, the current conditions, and the policy verdict.
 *
 * One slice rather than three because they are loaded together and are only meaningful
 * together — a WBGT band without the lightning state above it is precisely the reading FR-12a
 * says must never be presented on its own.
 *
 * Not persisted. Safety data has a validity window, and rehydrating yesterday's stop-work
 * warning from AsyncStorage would be worse than showing nothing. Offline caching with a
 * visible staleness marker is FR-26a / SCRUM-130, and needs its own design.
 */
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import {
  fetchLightningRisk,
  fetchMyShift,
  fetchSiteConditions,
  fetchSiteWeather,
} from "@/api/endpoints/safety";
import { fetchAccessibleSites } from "@/api/endpoints/sites";
import { isMockApi } from "@/auth/authMode";
import { isApiError, messageKeyFor, type ApiError } from "@/api/errors";
import type { LightningRisk, MyShift, PolicyEvaluation, SiteConditions } from "@/types/domain";

export type SafetyStatus = "idle" | "loading" | "ready" | "error";

export interface SafetyState {
  status: SafetyStatus;
  /** Null once loaded means "no current or upcoming shift" — a legitimate answer. */
  shift: MyShift | null;
  lightning: LightningRisk | null;
  conditions: SiteConditions | null;
  policy: PolicyEvaluation | null;
  errorKey: string | null;
  requestId: string | null;
  /** True for a pull-to-refresh, so the screen refreshes in place instead of blanking. */
  refreshing: boolean;
}

const initialState: SafetyState = {
  status: "idle",
  shift: null,
  lightning: null,
  conditions: null,
  policy: null,
  errorKey: null,
  requestId: null,
  refreshing: false,
};

interface LoadedPayload {
  shift: MyShift | null;
  lightning: LightningRisk | null;
  conditions: SiteConditions | null;
  policy: PolicyEvaluation | null;
}

/**
 * The reading behind the Heat conditions card, and where it comes from.
 *
 * ── WHY THIS IS NOT SIMPLY `fetchSiteConditions` ────────────────────────────────────────
 * `GET /api/v1/sites/{siteId}/conditions` (§12.1) does not exist, so the mock is the only
 * source of a *policy*. But the card itself no longer shows a policy: SCRUM-196 stripped it
 * to a bare WBGT reading and its freshness, and `features.heatGuidanceCard` is off. What it
 * needs is a `SiteConditions`, and since SCRUM-209 there is a real endpoint serving exactly
 * that from the NEA ingestion.
 *
 * ── THE SITE ID IS DELIBERATELY NOT THE SHIFT'S ─────────────────────────────────────────
 * `fetchMyShift` is still mocked — `/shifts/me` does not exist either — and the site id it
 * returns is a fixture UUID (`11111111-…`) that no deployment has, because `DemoDataSeeder`
 * creates sites with generated ids. Asking the live endpoint about it yields a 403, not a
 * reading. So outside mock mode the site is resolved from the real `GET /api/v1/sites`, the
 * same way `weatherSlice` already does it.
 *
 * That makes the shift screen a **hybrid while `/shifts/me` is missing**: a fixture shift
 * and task, with a live reading for the worker's first accessible site rather than for the
 * site the fixture names. Honest for verification and wrong for production — which is
 * survivable only because the whole shift above it is a fixture too. When `/shifts/me`
 * lands, this collapses back to one line: pass `shift.siteId` and delete the lookup.
 *
 * The policy is null here rather than the mock's. Pairing a real reading with a fixture
 * obligation would be worse than having none: it would look authoritative and be invented.
 */
async function loadConditions(
  shift: MyShift,
  workerId: string,
): Promise<{ conditions: SiteConditions | null; policy: PolicyEvaluation | null }> {
  if (isMockApi()) {
    const response = await fetchSiteConditions(shift.siteId, shift.assignment.intensity, workerId);
    return { conditions: response.observation, policy: response.policy };
  }

  // `siteIds` is a mock-only argument; the real endpoint filters by membership server-side.
  const sites = await fetchAccessibleSites([]);
  const siteId = sites[0]?.id;

  // No memberships is a legitimate answer, not a failure — see `fetchAccessibleSites`. The
  // card is simply absent, which is what it already does for a null reading.
  if (!siteId) {
    return { conditions: null, policy: null };
  }

  const weather = await fetchSiteWeather(siteId, workerId);
  return { conditions: weather.observation, policy: null };
}

/**
 * Loads the shift first, then the site data it points at.
 *
 * Sequential by necessity, not by oversight: the site whose lightning and conditions matter
 * is the site of the shift the worker is actually on, and that is only known after the
 * first call. Falling back to the user's first membership would show a worker the weather
 * somewhere they are not standing.
 */
export const loadWorkerSafety = createAsyncThunk<
  LoadedPayload,
  { workerId: string; refreshing?: boolean },
  { rejectValue: { errorKey: string; requestId: string | null } }
>("safety/load", async ({ workerId }, { rejectWithValue }) => {
  try {
    const shift = await fetchMyShift();

    if (!shift) {
      return { shift: null, lightning: null, conditions: null, policy: null };
    }

    // Independent of each other, so they overlap. On a site connection that is the
    // difference between one wait and two.
    const [lightning, conditions] = await Promise.all([
      fetchLightningRisk(shift.siteId),
      loadConditions(shift, workerId),
    ]);

    return {
      shift,
      lightning,
      conditions: conditions.conditions,
      policy: conditions.policy,
    };
  } catch (error) {
    if (isApiError(error)) {
      const apiError = error as ApiError;
      return rejectWithValue({
        errorKey: messageKeyFor(apiError),
        requestId: apiError.requestId,
      });
    }
    return rejectWithValue({ errorKey: "errors.unknown", requestId: null });
  }
});

const safetySlice = createSlice({
  name: "safety",
  initialState,
  reducers: {
    /** Dropped on sign-out: the next user must never see the previous one's shift. */
    clearSafety: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadWorkerSafety.pending, (state, action) => {
        // Pull-to-refresh spins the control; a first load shows the loader; a background
        // poll that already has data changes nothing, so the stop-work banner is never
        // replaced by a spinner while someone is reading it.
        if (action.meta.arg.refreshing) {
          state.refreshing = true;
        } else if (state.status !== "ready") {
          state.status = "loading";
        }
        state.errorKey = null;
      })
      .addCase(loadWorkerSafety.fulfilled, (state, action) => {
        state.status = "ready";
        state.refreshing = false;
        state.shift = action.payload.shift;
        state.lightning = action.payload.lightning;
        state.conditions = action.payload.conditions;
        state.policy = action.payload.policy;
        state.errorKey = null;
        state.requestId = null;
      })
      .addCase(loadWorkerSafety.rejected, (state, action) => {
        state.status = "error";
        state.refreshing = false;
        state.errorKey = action.payload?.errorKey ?? "errors.unknown";
        state.requestId = action.payload?.requestId ?? null;
      })

      /*
       * Reset whenever the session ends, deliberately or otherwise.
       *
       * Without this the slice outlives the user. Signing out and back in as a different
       * worker would render the previous worker's shift, task and site for the frame before
       * the new load resolves — the wrong crew's safety data on a safety screen. Handled
       * here rather than by the screen so it cannot be forgotten by the next screen that
       * reads this slice.
       */
      .addMatcher(
        (action) => action.type === "auth/signOut/fulfilled" || action.type === "auth/sessionExpired/fulfilled",
        () => initialState,
      );
  },
});

export const { clearSafety } = safetySlice.actions;

export default safetySlice.reducer;
