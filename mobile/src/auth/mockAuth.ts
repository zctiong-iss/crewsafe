/**
 * `mock` mode: signs in as a fixture, with no network at all.
 *
 * The access token is a sentinel, `mock.<userId>`, not a JWT. That shape is what lets the
 * rest of the app stay unaware of the mode: `restoreSession` reads SecureStore and resolves
 * a user exactly as it does for a real session, and `fetchCurrentUser` reads the id back
 * out of the sentinel instead of calling `GET /api/v1/me`. Without it, mock mode would need
 * its own parallel startup path, and the two would drift.
 *
 * The sentinel is deliberately not a well-formed JWT. If one of these ever reaches the
 * backend — a misconfigured build, a mode switched at the wrong moment — it must fail
 * signature validation loudly and immediately, not decode into something plausible.
 */
import { AuthError } from "./AuthError";
import { findDemoUser } from "./demoUsers";
import type { StoredSession } from "@/api/tokenStore";
import type { CurrentUser } from "@/types/domain";

const MOCK_TOKEN_PREFIX = "mock.";

/** Long enough that a demo is never interrupted by an expiry nobody is testing. */
const MOCK_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export function isMockToken(token: string): boolean {
  return token.startsWith(MOCK_TOKEN_PREFIX);
}

export function mockSessionFor(demoUserId: string): StoredSession {
  if (!findDemoUser(demoUserId)) {
    throw new AuthError("errors.unknown");
  }

  return {
    accessToken: `${MOCK_TOKEN_PREFIX}${demoUserId}`,
    // No refresh token: there is nothing to refresh against.
    refreshToken: null,
    expiresAt: Date.now() + MOCK_SESSION_DURATION_MS,
  };
}

/** Resolves the fixture behind a mock token. The mock counterpart of `GET /api/v1/me`. */
export function currentUserFromMockToken(token: string): CurrentUser {
  const user = findDemoUser(token.slice(MOCK_TOKEN_PREFIX.length));
  if (!user) {
    // The stored id is no longer in the fixture list — the app was updated underneath a
    // persisted session. Treated as "not provisioned", which is the same thing the real
    // backend would say about an account it has no row for.
    throw new AuthError("errors.not-provisioned");
  }
  return user;
}
