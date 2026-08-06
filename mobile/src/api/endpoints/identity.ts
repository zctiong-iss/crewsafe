/**
 * Who the signed-in user is: `GET /api/v1/me`, and its mock-mode counterpart.
 *
 * @author Justin Chua
 */
import { request } from "../client";
import { loadSession } from "../tokenStore";
import { isMockApi } from "@/auth/authMode";
import { currentUserFromMockToken } from "@/auth/mockAuth";
import { AuthError } from "@/auth/AuthError";
import type { CurrentUser } from "@/types/domain";

/**
 * `GET /api/v1/me` — the current user and their site memberships.
 *
 * Called immediately after any sign-in, and again at every launch. The database is the
 * authority on role and site access, not the token: a Cognito login with no CrewSafe user
 * row is authenticated but unauthorized, and asking is the only way to find that out. See
 * `MeController.java`.
 *
 * In mock mode the answer comes from the sentinel token instead of the network, so the
 * startup path is identical in both modes — see `mockAuth.ts`.
 */
export async function fetchCurrentUser(): Promise<CurrentUser> {
  if (isMockApi()) {
    const session = await loadSession();
    if (!session) throw new AuthError("errors.unauthenticated");
    return currentUserFromMockToken(session.accessToken);
  }

  return request<CurrentUser>({
    url: "/api/v1/me",
    method: "GET",
    // A 401 here is "no CrewSafe user row", not "session over" — see the flag's docs in
    // `api/client.ts`. `resolveSession` reads it as not-provisioned and keeps the token so
    // the retry has something to retry with.
    skipSessionTeardown: true,
  });
}
