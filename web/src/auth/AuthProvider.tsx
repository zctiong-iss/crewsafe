/**
 * @author Jemilin Beulah
 */
import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { User, UserManager } from "oidc-client-ts";
import { authConfig, cognitoSignOutUrl } from "./authConfig";
import { setTokenProvider } from "@/api/client";
import { fetchCurrentUser } from "@/api/identity";
import type { CurrentUser } from "@/api/identity";
import { ApiError } from "@/api/errors";
import { absoluteDeadlineFromAuthTime } from "./sessionPolicy";
import { useSessionTimeout } from "./useSessionTimeout";
import { SessionTimeoutNotice } from "./SessionTimeoutNotice";

/**
 * Every state the app can be in before it can render anything useful.
 *
 * Modelled as one union rather than a handful of booleans, because the combinations that
 * booleans allow — "loading and signed out and errored" — are exactly the ones that produce
 * a blank screen or a spinner that never stops.
 */
export type AuthState =
  | { status: "starting" }
  | { status: "signed-out" }
  /** Cognito accepted the login, but this account has no CrewSafe user row. */
  | { status: "not-provisioned"; requestId: string | null }
  /** Signed in and resolved against the backend. The only state that renders the app. */
  | { status: "signed-in"; user: CurrentUser }
  | { status: "failed"; reason: "network" | "server"; requestId: string | null };

export interface AuthContextValue {
  state: AuthState;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-run the backend identity lookup, e.g. after an administrator provisions the account. */
  retry: () => Promise<void>;
  /**
   * Finish the redirect from Cognito: exchange the authorization code, then resolve the
   * session.
   *
   * Lives here rather than in CallbackPage so that the exchange happens on *this* provider's
   * UserManager. A second UserManager writes the same sessionStorage keys, so the tokens
   * would land correctly — but this provider would never re-read them, and the app would sit
   * on the sign-in screen holding a perfectly good session.
   */
  completeSignIn: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const defaultRedirectTo = (url: string) => {
  window.location.href = url;
};

let productionUserManager: UserManager | null = null;

/**
 * The production manager owns silent-renew timers, so its lifetime must match the app rather
 * than an individual render or StrictMode mount check. Keep this lazy so tests that inject a
 * manager never start the real OIDC machinery.
 */
function getProductionUserManager(): UserManager {
  productionUserManager ??= new UserManager(authConfig);
  return productionUserManager;
}

export function AuthProvider({
  children,
  userManager,
  redirectTo = defaultRedirectTo,
  now = Date.now,
  activityTarget = document,
  sessionPolicyEnabled = true,
}: {
  children: ReactNode;
  /** Injectable so tests can drive auth without a real Cognito. */
  userManager?: UserManager;
  /**
   * Performs a full-page navigation. Injectable because signing out has to leave the SPA
   * entirely — it ends Cognito's own session, not just this app's — and jsdom does not
   * implement real navigation for tests to observe.
   */
  redirectTo?: (url: string) => void;
  now?: () => number;
  activityTarget?: Pick<Document, "addEventListener" | "removeEventListener">;
  sessionPolicyEnabled?: boolean;
}) {
  const managerRef = useRef<UserManager | null>(null);
  if (managerRef.current === null) {
    managerRef.current = userManager ?? getProductionUserManager();
  }
  const manager = managerRef.current;

  const [state, setState] = useState<AuthState>({ status: "starting" });
  const [absoluteDeadline, setAbsoluteDeadline] = useState<number | null>(null);

  const endSession = useCallback(async () => {
    try {
      await manager.revokeTokens(["refresh_token"]);
    } catch {
      // Remote revocation is best effort and is bounded by authConfig.requestTimeoutInSeconds.
    }

    try {
      // Clear our own tokens first. The redirect below is a full-page navigation away
      // from this origin and back, and sessionStorage survives that round trip — so if
      // Cognito's own logout somehow failed, this app's session must not survive it.
      await manager.removeUser();
    } catch {
      // A storage failure must not prevent the app state or Cognito cookie from being ended.
    } finally {
      setAbsoluteDeadline(null);
      setState({ status: "signed-out" });
      // Then end Cognito's session too. Without this, its session cookie outlives ours:
      // the next "Sign in" click on this browser re-authenticates silently, no password,
      // regardless of who is sitting at the machine now.
      redirectTo(cognitoSignOutUrl());
    }
  }, [manager, redirectTo]);

  // Give the API client a way to read the current token without importing auth state.
  useEffect(() => {
    setTokenProvider(async () => {
      const user = await manager.getUser();
      // An expired token is worse than none: sending it produces a 401 the app would have
      // to interpret, when it already knows the session is stale.
      return user && !user.expired ? user.access_token : null;
    });
  }, [manager]);

  const resolveSession = useCallback(async () => {
    const user: User | null = await manager.getUser();

    if (!user) {
      setAbsoluteDeadline(null);
      setState({ status: "signed-out" });
      return;
    }

    if (user.expired) {
      await endSession();
      return;
    }

    const deadline = absoluteDeadlineFromAuthTime(user.profile.auth_time, now());
    if (deadline === null || deadline <= now()) {
      await endSession();
      return;
    }
    setAbsoluteDeadline(deadline);

    try {
      setState({ status: "signed-in", user: await fetchCurrentUser() });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setState({ status: "failed", reason: "server", requestId: null });
        return;
      }

      /*
       * The inference that makes the "not provisioned" screen possible.
       *
       * The API answers 401 identically for every cause — expired, forged, wrong issuer, no
       * local account — and that uniformity is deliberate: a caller must not be able to
       * probe which accounts exist. So the server cannot tell us why.
       *
       * The client can work it out anyway. We are holding an unexpired token that Cognito
       * itself just issued, so the token is not the problem; the missing piece must be on
       * our side. That reasoning stays here rather than being leaked into the API.
       */
      if (error.kind === "unauthenticated") {
        setState({ status: "not-provisioned", requestId: error.requestId });
        return;
      }

      setState({
        status: "failed",
        reason: error.kind === "network" ? "network" : "server",
        requestId: error.requestId,
      });
    }
  }, [endSession, manager, now]);

  useEffect(() => {
    void resolveSession();

    // Silent renew swaps the token underneath us; nothing to re-resolve, but if renewal
    // fails the session is genuinely over and the user must be told rather than left
    // clicking a UI whose every request now 401s.
    const onExpired = () => void endSession();
    manager.events.addAccessTokenExpired(onExpired);
    manager.events.addSilentRenewError(onExpired);

    return () => {
      manager.events.removeAccessTokenExpired(onExpired);
      manager.events.removeSilentRenewError(onExpired);
    };
  }, [endSession, manager, resolveSession]);

  const { warning, continueSession } = useSessionTimeout({
    // A valid Cognito token also exists in not-provisioned and backend-failure states.
    active: sessionPolicyEnabled && absoluteDeadline !== null,
    absoluteDeadline,
    onExpire: () => void endSession(),
    now,
    activityTarget,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signIn: () => manager.signinRedirect(),
      signOut: endSession,
      retry: resolveSession,
      completeSignIn: async () => {
        await manager.signinRedirectCallback();
        await resolveSession();
      },
    }),
    [state, manager, endSession, resolveSession],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <SessionTimeoutNotice
        warning={warning}
        onContinue={continueSession}
        onSignOut={() => void endSession()}
      />
    </AuthContext.Provider>
  );
}
