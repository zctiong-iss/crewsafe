/**
 * The site's heat policy version catalogue (SCRUM-120 / US-24).
 *
 * ── WHY THE WHOLE LIST, NOT JUST THE ACTIVE ONE ─────────────────────────────────────────
 * `/policy-versions/active` exists and is cheaper, but the catalogue screen needs the history and
 * the recommendation link needs to resolve an arbitrary version by id — including superseded ones,
 * which is the entire point of tracing an old recommendation. One list read serves all three, and
 * a site's version count is measured in tens over its lifetime.
 *
 * ── ACTIVATION IS NOT A TOGGLE ──────────────────────────────────────────────────────────
 * Activating retires the previous version, server-side, in the same transaction. This slice never
 * models that optimistically: it replaces the whole list from a re-read afterwards, because the
 * one thing worse than a slow screen here is one showing two active versions, or none.
 *
 * @author Justin Chua
 */
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import {
  activatePolicyVersion as activateRequest,
  createPolicyVersion as createRequest,
  fetchPolicyVersions,
  type PolicyVersionInput,
} from "@/api/endpoints/policyVersions";
import { isApiError, messageKeyFor, type ApiError } from "@/api/errors";
import type { PolicyVersion } from "@/types/domain";

export type PolicyStatus = "idle" | "loading" | "ready" | "error";

export interface PolicyState {
  versions: PolicyVersion[];
  status: PolicyStatus;
  refreshing: boolean;
  errorKey: string | null;
  creating: boolean;
  /** Version id being activated, so only that row shows a spinner. */
  activatingId: string | null;
}

const initialState: PolicyState = {
  versions: [],
  status: "idle",
  refreshing: false,
  errorKey: null,
  creating: false,
  activatingId: null,
};

export const loadPolicyVersions = createAsyncThunk<
  PolicyVersion[],
  { siteId: string; refreshing?: boolean },
  { rejectValue: { errorKey: string } }
>("policy/load", async ({ siteId }, { rejectWithValue }) => {
  try {
    return await fetchPolicyVersions(siteId);
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
});

/**
 * Guarded on `creating`: the form resolves its validation asynchronously, so `creating` is set a
 * render *after* the tap. Two taps inside that window would send two creates — and the second
 * fails on the unique label, telling the safety manager their own version already exists.
 */
export const createPolicyVersion = createAsyncThunk<
  PolicyVersion,
  { siteId: string; input: PolicyVersionInput },
  { rejectValue: { errorKey: string } }
>("policy/create", async ({ siteId, input }, { rejectWithValue }) => {
  try {
    return await createRequest(siteId, input);
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
}, {
  condition: (_arg, { getState }) => !(getState() as { policy: PolicyState }).policy.creating,
});

export const activatePolicyVersion = createAsyncThunk<
  PolicyVersion[],
  { siteId: string; versionId: string },
  { rejectValue: { errorKey: string } }
>("policy/activate", async ({ siteId, versionId }, { rejectWithValue }) => {
  try {
    await activateRequest(siteId, versionId);
    /*
     * Re-read rather than patch. Activation changes two rows — the incoming version and the one
     * it retires — and reconstructing that here would be this client guessing at a transaction
     * the server already performed. The list is small; the correctness is not negotiable.
     */
    return await fetchPolicyVersions(siteId);
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ errorKey });
  }
}, {
  condition: ({ versionId }, { getState }) =>
    (getState() as { policy: PolicyState }).policy.activatingId !== versionId,
});

/** Newest effective date first, matching the server. Ties break on `createdAt` so the order is stable. */
function ordered(versions: PolicyVersion[]): PolicyVersion[] {
  return [...versions].sort((a, b) => {
    const byDate = b.effectiveDate.localeCompare(a.effectiveDate);
    return byDate !== 0 ? byDate : b.createdAt.localeCompare(a.createdAt);
  });
}

const policySlice = createSlice({
  name: "policy",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadPolicyVersions.pending, (state, action) => {
        if (action.meta.arg.refreshing) state.refreshing = true;
        else if (state.status !== "ready") state.status = "loading";
        state.errorKey = null;
      })
      .addCase(loadPolicyVersions.fulfilled, (state, action) => {
        state.status = "ready";
        state.refreshing = false;
        state.versions = ordered(action.payload);
      })
      .addCase(loadPolicyVersions.rejected, (state, action) => {
        state.status = "error";
        state.refreshing = false;
        state.errorKey = action.payload?.errorKey ?? "errors.unknown";
      })

      .addCase(createPolicyVersion.pending, (state) => {
        state.creating = true;
      })
      .addCase(createPolicyVersion.fulfilled, (state, action) => {
        state.creating = false;
        // Inserted locally so the catalogue already shows it when the form pops back, rather
        // than looking unchanged until the next load.
        state.versions = ordered([action.payload, ...state.versions]);
      })
      // Reported on the form, where the fields are. The slice only releases the button.
      .addCase(createPolicyVersion.rejected, (state) => {
        state.creating = false;
      })

      .addCase(activatePolicyVersion.pending, (state, action) => {
        state.activatingId = action.meta.arg.versionId;
      })
      .addCase(activatePolicyVersion.fulfilled, (state, action) => {
        state.activatingId = null;
        state.versions = ordered(action.payload);
      })
      .addCase(activatePolicyVersion.rejected, (state) => {
        state.activatingId = null;
      })

      // Policy is per site, and sites are per user. Leaving it would show the next person to sign
      // in on a shared phone the rules of a site they may have no access to.
      .addMatcher(
        (action) =>
          action.type === "auth/signOut/fulfilled" ||
          action.type === "auth/sessionExpired/fulfilled",
        () => initialState,
      );
  },
});

/** The version currently in force, or null before anything has loaded. */
export function selectActiveVersion(state: { policy: PolicyState }): PolicyVersion | null {
  return state.policy.versions.find((version) => version.status === "ACTIVE") ?? null;
}

export default policySlice.reducer;
