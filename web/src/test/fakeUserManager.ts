import type { UserManager } from "oidc-client-ts";

export interface FakeSession {
  accessToken?: string;
  expired?: boolean;
}

/**
 * A stand-in for oidc-client-ts's UserManager.
 *
 * Tests here are about how the *app* behaves once Cognito has answered — signed in, signed
 * out, token expired. Driving a real UserManager would mean stubbing a discovery document,
 * a JWKS and a token endpoint to observe behaviour that does not depend on any of them.
 * The genuine token exchange is covered against real Cognito on the backend instead.
 */
export function fakeUserManager(session: FakeSession | null): UserManager {
  const listeners = { expired: [] as (() => void)[], renewError: [] as (() => void)[] };

  return {
    getUser: async () =>
      session
        ? { access_token: session.accessToken ?? "test-access-token", expired: session.expired ?? false }
        : null,
    signinRedirect: async () => undefined,
    removeUser: async () => undefined,
    events: {
      addAccessTokenExpired: (cb: () => void) => listeners.expired.push(cb),
      removeAccessTokenExpired: () => undefined,
      addSilentRenewError: (cb: () => void) => listeners.renewError.push(cb),
      removeSilentRenewError: () => undefined,
    },
  } as unknown as UserManager;
}
