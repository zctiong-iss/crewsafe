/**
 * authSlice (SCRUM-352 / FR-002).
 *
 * One status union rather than a handful of booleans, precisely so "signed out and errored
 * and loading" cannot happen (see the file's own header comment). Asserts the sign-in
 * success/failure transitions, sign-out (including the must-succeed-locally-even-on-failure
 * case), and the involuntary 401 teardown via `sessionExpired` — the auth-lifecycle paths
 * this feature's scope names, not every reducer case in the 327-line file.
 */
import reducer, {
  clearError,
  resolveSession,
  restoreSession,
  sessionExpired,
  signIn,
  signOut,
  type AuthState,
} from "./authSlice";
import { ApiError } from "@/api/errors";
import type { CurrentUser } from "@/types/domain";

const initialState: AuthState = {
  status: "starting",
  user: null,
  errorKey: null,
  errorParams: {},
  requestId: null,
  signingIn: false,
  signingOut: false,
};

const USER: CurrentUser = {
  id: "u1",
  username: "worker1",
  displayName: "Worker One",
  role: "WORKER",
  siteIds: ["s1"],
};

it("starts in the starting status", () => {
  expect(reducer(undefined, { type: "@@INIT" })).toEqual(initialState);
});

describe("sign-in", () => {
  it("shows a spinner and clears any prior error while a sign-in is in flight", () => {
    const dirty: AuthState = { ...initialState, errorKey: "errors.unknown" };
    const state = reducer(dirty, signIn.pending("req-1", {}));
    expect(state.signingIn).toBe(true);
    expect(state.errorKey).toBeNull();
  });

  it("resolves to signed-in once the user is fetched", () => {
    const afterPending = reducer(initialState, signIn.pending("req-1", {}));
    const state = reducer(afterPending, resolveSession.fulfilled(USER, "req-2", undefined));

    expect(state.status).toBe("signed-in");
    expect(state.user).toEqual(USER);
    expect(state.signingIn).toBe(false);
  });

  it("surfaces a translation-key error and stays signed-out on invalid credentials", () => {
    const state = reducer(
      initialState,
      signIn.rejected(new Error("rejected"), "req-1", {}, {
        status: "signed-out",
        errorKey: "auth.cognito.invalidCredentials",
        errorParams: {},
        requestId: null,
      }),
    );

    expect(state.status).toBe("signed-out");
    expect(state.errorKey).toBe("auth.cognito.invalidCredentials");
    expect(state.signingIn).toBe(false);
    expect(state.user).toBeNull();
  });

  it("resolves to not-provisioned when the account has no CrewSafe user row", () => {
    const apiError = new ApiError("unauthenticated", "HTTP 401", 401, "req-abc");
    const state = reducer(
      initialState,
      resolveSession.rejected(new Error("rejected"), "req-1", undefined, {
        status: "not-provisioned",
        errorKey: "errors.not-provisioned",
        errorParams: {},
        requestId: apiError.requestId,
      }),
    );

    expect(state.status).toBe("not-provisioned");
    expect(state.requestId).toBe("req-abc");
  });
});

describe("sign-out", () => {
  const signedIn: AuthState = { ...initialState, status: "signed-in", user: USER };

  it("shows a spinner while signing out", () => {
    const state = reducer(signedIn, signOut.pending("req-1", undefined));
    expect(state.signingOut).toBe(true);
  });

  it("clears the session on a successful sign-out", () => {
    const state = reducer(signedIn, signOut.fulfilled(undefined, "req-1", undefined));
    expect(state.status).toBe("signed-out");
    expect(state.user).toBeNull();
  });

  it("still clears the session locally even when sign-out itself fails", () => {
    // performSignOut's network steps are best-effort and swallow their own errors, so
    // reaching `rejected` means the local SecureStore write threw. Leaving the user signed
    // in would be the worst possible response to "sign me out".
    const state = reducer(
      signedIn,
      signOut.rejected(new Error("SecureStore write failed"), "req-1", undefined),
    );
    expect(state.status).toBe("signed-out");
    expect(state.user).toBeNull();
  });
});

describe("involuntary session teardown", () => {
  it("signs the user out and explains why, on a 401 the app did not ask for", () => {
    const signedIn: AuthState = { ...initialState, status: "signed-in", user: USER };

    const state = reducer(signedIn, sessionExpired.fulfilled(undefined, "req-1", undefined));

    expect(state.status).toBe("signed-out");
    expect(state.user).toBeNull();
    // The one difference from a deliberate sign-out: an explanation survives so the user
    // knows why they are suddenly looking at the sign-in screen.
    expect(state.errorKey).toBe("errors.unauthenticated");
  });
});

describe("restoreSession", () => {
  it("goes straight to signed-out when nothing was stored", () => {
    const state = reducer(initialState, restoreSession.fulfilled(false, "req-1", undefined));
    expect(state.status).toBe("signed-out");
  });

  it("goes to signed-out if the restore itself fails", () => {
    const state = reducer(
      initialState,
      restoreSession.rejected(new Error("boom"), "req-1", undefined),
    );
    expect(state.status).toBe("signed-out");
  });
});

describe("clearError", () => {
  it("dismisses a failure banner without changing anything else", () => {
    const failed: AuthState = {
      ...initialState,
      status: "failed",
      errorKey: "errors.server",
      requestId: "req-xyz",
    };

    const state = reducer(failed, clearError());

    expect(state.errorKey).toBeNull();
    expect(state.requestId).toBeNull();
    expect(state.status).toBe("failed");
  });
});
