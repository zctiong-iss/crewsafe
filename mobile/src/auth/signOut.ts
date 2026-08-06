/**
 * Signing out properly — which is more than forgetting our own token.
 *
 * Three things can outlive a naive sign-out, and each is a way for the next person holding
 * the phone to end up inside the previous person's account:
 *
 *   1. The stored access token.   Cleared always, first, before anything that can fail.
 *   2. The refresh token.         Still valid server-side until revoked. Both app clients
 *                                 set `enable_token_revocation = true` precisely so this
 *                                 is possible.
 *   3. Cognito's own session.     The Hosted UI keeps a session cookie in the browser that
 *                                 is entirely separate from our tokens. Clear ours without
 *                                 clearing that, and the next "Sign in" tap re-authenticates
 *                                 silently — no password prompt — as whoever used the device
 *                                 last. `web/src/auth/authConfig.ts` documents the same trap
 *                                 for the console; a shared site phone makes it worse.
 *
 * Ordering matters: the local session is cleared before either remote call, so a failure
 * or a dismissed browser can never leave the app still signed in. Both remote steps are
 * best-effort for the same reason — a worker on a dead connection must still be able to
 * sign out of the device in their hand.
 *
 * @author Justin Chua
 */
import axios from "axios";
import * as WebBrowser from "expo-web-browser";
import { clearSession, loadSession } from "@/api/tokenStore";
import { config, pkceClientId } from "@/constants/config";
import { IS_WEB } from "@/constants/constants";
import { getAuthMode } from "./authMode";

/**
 * Must match the client's registered `logout_urls` exactly — Cognito rejects anything else,
 * and both lists are pinned to a single value by Terraform validation:
 * `crewsafe://` for mobile, `http://localhost:5173/` for web.
 */
function logoutRedirectUri(): string {
  if (IS_WEB) {
    return typeof window === "undefined" ? "http://localhost:5173/" : `${window.location.origin}/`;
  }
  return "crewsafe://";
}

/**
 * Cognito's `/logout`, built by hand.
 *
 * Its discovery document advertises a standard OIDC `end_session_endpoint`, which makes
 * generic RP-initiated logout look like it should work. It does not: Cognito's `/logout`
 * predates that support and ignores `post_logout_redirect_uri` and `id_token_hint`. It
 * wants its own `client_id` and `logout_uri`, checked against the app client's sign-out URLs.
 */
function hostedUiLogoutUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    logout_uri: logoutRedirectUri(),
  });
  return `${config.cognito.hostedUiDomain}/logout?${params.toString()}`;
}

/** Best-effort. A refresh token we cannot reach is still gone from this device. */
async function revokeRefreshToken(refreshToken: string, clientId: string): Promise<void> {
  await axios.post(
    `${config.cognito.hostedUiDomain}/oauth2/revoke`,
    new URLSearchParams({ token: refreshToken, client_id: clientId }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 8_000,
    },
  );
}

export async function performSignOut(): Promise<void> {
  const mode = getAuthMode();
  const session = await loadSession();

  // Always first. Everything below may fail, and none of it may leave us signed in.
  await clearSession();

  if (mode === "mock") return;

  const clientId = mode === "cognito-password" ? config.cognito.cliClientId : pkceClientId();
  if (!clientId || !config.cognito.hostedUiDomain) return;

  if (session?.refreshToken) {
    try {
      await revokeRefreshToken(session.refreshToken, clientId);
    } catch {
      // Offline, or the token was already revoked. Neither changes the local outcome.
    }
  }

  /*
   * Only the PKCE flow leaves a browser session to end. `cognito-password` talks to
   * InitiateAuth directly and never opens the Hosted UI, so there is no cookie — and
   * launching a browser on sign-out would be a baffling thing for the app to do.
   */
  if (mode === "cognito-pkce") {
    try {
      await WebBrowser.openAuthSessionAsync(hostedUiLogoutUrl(clientId), logoutRedirectUri());
    } catch {
      // Dismissed, or no browser available.
    }
  }
}
