/**
 * Session state, modelled as one status union rather than a handful of booleans.
 *
 * Ported from `web/src/auth/AuthProvider.tsx`, which explains the choice best: booleans
 * allow combinations like "loading and signed out and errored", and those are exactly the
 * ones that produce a blank screen or a spinner that never stops.
 *
 * This slice is NOT persisted. Tokens live in SecureStore (`api/tokenStore.ts`); the user
 * profile is re-fetched from `GET /api/v1/me` on every launch, because role and site
 * membership are revocable server-side and a cached copy could keep showing a supervisor
 * tools they lost access to yesterday.
 *
 * Failures are held as i18n keys, never as messages. A message captured here would be
 * frozen in whatever language was active when it happened, and would not follow a language
 * change made on the very next screen.
 *
 * @author Justin Chua
 */
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { fetchCurrentUser } from "@/api/endpoints/identity";
import { isApiError, messageKeyFor, type ApiError } from "@/api/errors";
import { clearSession, isExpired, loadSession } from "@/api/tokenStore";
import { isAuthError, type AuthError } from "@/auth/AuthError";
import { isMockApi } from "@/auth/authMode";
import { isMockToken } from "@/auth/mockAuth";
import { performSignIn, type SignInParams } from "@/auth/signIn";
import { performSignOut } from "@/auth/signOut";
import type { CurrentUser } from "@/types/domain";

export type AuthStatus =
  /** Before the stored session has been read. Renders the splash, never the app. */
  | "starting"
  | "signed-out"
  /** Cognito accepted the login, but this account has no CrewSafe user row. */
  | "not-provisioned"
  /** Signed in and resolved against the backend. The only status that renders the app. */
  | "signed-in"
  | "failed";

export interface AuthState {
  status: AuthStatus;
  user: CurrentUser | null;
  /** i18n key for the current failure, or null. Render with `t(errorKey, errorParams)`. */
  errorKey: string | null;
  errorParams: Record<string, string>;
  /** The X-Request-Id to quote when reporting a failure, when the server sent one. */
  requestId: string | null;
  /** True while a sign-in attempt is in flight, so the button can show a spinner. */
  signingIn: boolean;
  /**
   * True while signing out. Separate from `signingIn` because sign-out is not instant:
   * it revokes the refresh token over the network and, on the PKCE flow, waits on a
   * browser. Without this the button looks dead for as long as that takes.
   */
  signingOut: boolean;
}

const initialState: AuthState = {
  status: "starting",
  user: null,
  errorKey: null,
  errorParams: {},
  requestId: null,
  signingIn: false,
  signingOut: false,
};

interface FailurePayload {
  status: AuthStatus;
  errorKey: string | null;
  errorParams: Record<string, string>;
  requestId: string | null;
}

/**
 * Turns "we hold a token" into "we know who this is", or explains why not.
 *
 * The inference that makes the not-provisioned screen possible lives here. The API answers
 * 401 identically for every cause — expired, forged, wrong issuer, no local account — and
 * that uniformity is deliberate, so the server cannot tell us which it was. But we are
 * holding a token Cognito itself just issued and that has not expired, so the token is not
 * the problem; the missing piece must be on our side. That reasoning stays in the client
 * rather than leaking into the API.
 */
export const resolveSession = createAsyncThunk<
  CurrentUser,
  void,
  { rejectValue: FailurePayload }
>("auth/resolveSession", async (_arg, { rejectWithValue }) => {
  try {
    return await fetchCurrentUser();
  } catch (error) {
    if (isAuthError(error)) {
      const authError = error as AuthError;
      return rejectWithValue({
        status: authError.messageKey === "errors.not-provisioned" ? "not-provisioned" : "failed",
        errorKey: authError.messageKey,
        errorParams: authError.messageParams,
        requestId: null,
      });
    }

    if (!isApiError(error)) {
      return rejectWithValue({
        status: "failed",
        errorKey: "errors.unknown",
        errorParams: {},
        requestId: null,
      });
    }

    const apiError = error as ApiError;

    if (apiError.kind === "unauthenticated") {
      return rejectWithValue({
        status: "not-provisioned",
        errorKey: "errors.not-provisioned",
        errorParams: {},
        requestId: apiError.requestId,
      });
    }

    return rejectWithValue({
      status: "failed",
      errorKey: messageKeyFor(apiError),
      errorParams: {},
      requestId: apiError.requestId,
    });
  }
});

/** Run once at launch: read SecureStore, then resolve whatever it held. */
export const restoreSession = createAsyncThunk("auth/restoreSession", async (_arg, { dispatch }) => {
  const stored = await loadSession();

  if (!stored || isExpired(stored)) {
    // An expired token is worse than none: sending it produces a 401 the app would have to
    // interpret, when it already knows the session is stale.
    await clearSession();
    return false;
  }

  /*
   * Discard a session left behind by a different auth mode.
   *
   * The sign-in screen's mode selector clears the session on switch, but editing
   * `EXPO_PUBLIC_AUTH_MODE` in `.env` and reloading bypasses it — which is how a developer
   * actually changes mode. Without this check the mismatch surfaces as a misleading
   * failure: a `mock.` sentinel sent to the real backend comes back 401 and is reported as
   * "your account is not set up", while a real Cognito JWT read as a sentinel resolves to
   * no fixture and says the same. Both point the reader at provisioning, which is not the
   * problem at all.
   */
  if (isMockToken(stored.accessToken) !== isMockApi()) {
    await clearSession();
    return false;
  }

  await dispatch(resolveSession());
  return true;
});

/**
 * Authenticate, then resolve the user.
 *
 * `resolveSession` is dispatched rather than inlined so that the path from token to user is
 * the same one `restoreSession` takes at launch — including the not-provisioned inference,
 * which would otherwise have to be duplicated and kept in step.
 */
export const signIn = createAsyncThunk<void, SignInParams, { rejectValue: FailurePayload }>(
  "auth/signIn",
  async (params, { dispatch, rejectWithValue }) => {
    try {
      await performSignIn(params);
    } catch (error) {
      const authError = isAuthError(error) ? (error as AuthError) : null;
      return rejectWithValue({
        status: "signed-out",
        errorKey: authError?.messageKey ?? "errors.unknown",
        errorParams: authError?.messageParams ?? {},
        requestId: null,
      });
    }

    await dispatch(resolveSession());
  },
);

/**
 * A deliberate sign-out. Clears the local session, revokes the refresh token, and ends
 * Cognito's own browser session — see `auth/signOut.ts` for why the last one matters.
 */
export const signOut = createAsyncThunk("auth/signOut", async () => {
  await performSignOut();
});

/**
 * The server rejected a token we believed was good — revoked, or the pool was swapped
 * underneath us.
 *
 * A thunk rather than a plain action because the stored token has to go too. Clearing only
 * the Redux state would leave the dead token in SecureStore, and the next launch would
 * load it, replay it, and fail identically — the user would be bounced to sign-in on every
 * start with no way to break the cycle short of reinstalling.
 *
 * Local clear only, unlike `signOut`: this is involuntary, and throwing a browser at
 * someone who did not ask to be signed out — possibly mid-task, possibly while the phone is
 * in a pocket — would be worse than leaving Cognito's cookie to expire on its own.
 */
export const sessionExpired = createAsyncThunk("auth/sessionExpired", async () => {
  await clearSession();
});

function signedOut(state: AuthState) {
  state.status = "signed-out";
  state.user = null;
  state.errorKey = null;
  state.errorParams = {};
  state.requestId = null;
  state.signingIn = false;
  state.signingOut = false;
}

function applyFailure(state: AuthState, payload: FailurePayload | undefined) {
  state.status = payload?.status ?? "failed";
  state.errorKey = payload?.errorKey ?? "errors.unknown";
  state.errorParams = payload?.errorParams ?? {};
  state.requestId = payload?.requestId ?? null;
  state.user = null;
  state.signingIn = false;
  state.signingOut = false;
}

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    /** Dismiss a failure banner without retrying. */
    clearError: (state) => {
      state.errorKey = null;
      state.errorParams = {};
      state.requestId = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(restoreSession.pending, (state) => {
        state.status = "starting";
      })
      .addCase(restoreSession.fulfilled, (state, action) => {
        // A restored session that resolved is settled by resolveSession's own cases; only
        // the "nothing stored" outcome needs handling here. Note this must not clear
        // errorKey — on a cold start there is nothing to clear, and on a later re-run the
        // resolve cases own it.
        if (!action.payload) {
          state.status = "signed-out";
          state.user = null;
        }
      })
      .addCase(restoreSession.rejected, (state) => {
        state.status = "signed-out";
        state.user = null;
      })

      .addCase(signIn.pending, (state) => {
        state.signingIn = true;
        state.errorKey = null;
        state.errorParams = {};
        state.requestId = null;
      })
      .addCase(signIn.fulfilled, (state) => {
        // Success or failure is decided by the resolveSession dispatched inside; this only
        // releases the button.
        state.signingIn = false;
      })
      .addCase(signIn.rejected, (state, action) => {
        applyFailure(state, action.payload);
      })

      .addCase(resolveSession.pending, (state) => {
        state.signingIn = true;
      })
      .addCase(resolveSession.fulfilled, (state, action) => {
        state.status = "signed-in";
        state.user = action.payload;
        state.errorKey = null;
        state.errorParams = {};
        state.requestId = null;
        state.signingIn = false;
      })
      .addCase(resolveSession.rejected, (state, action) => {
        applyFailure(state, action.payload);
      })

      .addCase(signOut.pending, (state) => {
        state.signingOut = true;
      })
      .addCase(signOut.fulfilled, (state) => {
        signedOut(state);
      })
      /*
       * Signing out must succeed locally even when it fails.
       *
       * `performSignOut` swallows the network steps, so reaching here means the SecureStore
       * write itself threw. Leaving the user signed in would be the worst possible response
       * to "sign me out" — they asked to leave, and on a shared site phone the next person
       * is already waiting. The in-memory session goes regardless; a token that outlives it
       * on disk is caught by the expiry and mode checks in `restoreSession`.
       */
      .addCase(signOut.rejected, (state) => {
        signedOut(state);
      })

      // Same end state as a deliberate sign-out, but it keeps an explanation: the user did
      // not ask to be signed out and deserves to know why they are looking at sign-in.
      .addCase(sessionExpired.fulfilled, (state) => {
        signedOut(state);
        // The one difference from a deliberate sign-out: the user did not ask for this and
        // deserves to know why they are suddenly looking at the sign-in screen.
        state.errorKey = "errors.unauthenticated";
      });
  },
});

export const { clearError } = authSlice.actions;

export default authSlice.reducer;
