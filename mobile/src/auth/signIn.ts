/**
 * The one entry point for signing in. Picks a mode, produces a session, stores it.
 *
 * Everything above this — the auth slice, the screen, the navigator — is mode-agnostic and
 * must stay that way. If a screen ever needs to know which mode is active in order to
 * decide what to *do* (as opposed to which fields to show), the seam has leaked.
 *
 * @author Justin Chua
 */
import { assertModeAllowed, getAuthMode } from "./authMode";
import { AuthError } from "./AuthError";
import { mockSessionFor } from "./mockAuth";
import { signInWithPassword } from "./cognitoPasswordAuth";
import { signInWithPkce } from "./cognitoPkceAuth";
import { saveSession, type StoredSession } from "@/api/tokenStore";

export interface SignInParams {
  /** `cognito-password` only. */
  username?: string;
  /** `cognito-password` only. Never stored or logged — see `cognitoPasswordAuth.ts`. */
  password?: string;
  /** `mock` only: which fixture to sign in as. */
  demoUserId?: string;
}

async function sessionFor(params: SignInParams): Promise<StoredSession> {
  switch (getAuthMode()) {
    case "mock":
      if (!params.demoUserId) throw new AuthError("errors.unknown");
      return mockSessionFor(params.demoUserId);

    case "cognito-password":
      if (!params.username || !params.password) throw new AuthError("errors.unknown");
      return signInWithPassword(params.username, params.password);

    case "cognito-pkce":
      return signInWithPkce();
  }
}

/**
 * Authenticates and persists the session, returning nothing.
 *
 * Resolving *who* the session belongs to is a separate step (`resolveSession`), because it
 * is the same step taken at launch when restoring a stored session. Keeping them apart
 * means there is one code path from "we hold a token" to "we know the user", rather than
 * one for signing in and a second, subtly different one for relaunching.
 */
export async function performSignIn(params: SignInParams): Promise<void> {
  assertModeAllowed(getAuthMode());
  await saveSession(await sessionFor(params));
}
