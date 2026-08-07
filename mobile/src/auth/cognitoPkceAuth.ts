/**
 * `cognito-pkce` mode: the production-shaped flow — Hosted UI, authorization code + PKCE,
 * no client secret.
 *
 * Where this actually runs:
 *
 *   Expo web      Yes, today, with no infrastructure change — `npm run web:pkce` serves on
 *                 port 5173, and `http://localhost:5173/callback` is already a registered
 *                 callback on the Cognito *web* client. This is how to exercise the real
 *                 flow during development.
 *   Native build  Yes. `app.json` declares `scheme: "crewsafe"`, matching the mobile
 *                 client's pinned `crewsafe://callback`.
 *   Expo Go       No, and it cannot be made to. Expo Go is one app with one bundle id; it
 *                 registers `exp://` and cannot claim `crewsafe://`, because a custom
 *                 scheme is declared in a native manifest at build time. Cognito matches
 *                 callbacks exactly and the mobile client's list is pinned by a Terraform
 *                 validation rule to that single value. `cognito-password` exists for this
 *                 case.
 *
 * The Expo Go case is detected from the redirect URI itself rather than by sniffing the
 * runtime: if `makeRedirectUri` hands back an `exp://` URL, this flow cannot succeed, and
 * saying so up front is far kinder than Cognito's bare `redirect_mismatch` page.
 *
 * @author Justin Chua
 */
import { AuthRequest, exchangeCodeAsync, makeRedirectUri } from "expo-auth-session";
import { config, pkceClientId } from "@/constants/config";
import { AuthError } from "./AuthError";
import type { StoredSession } from "@/api/tokenStore";

/** Cognito's endpoints, built by hand — its discovery document adds a round trip for two URLs. */
function discoveryFor(hostedUiDomain: string) {
  return {
    authorizationEndpoint: `${hostedUiDomain}/oauth2/authorize`,
    tokenEndpoint: `${hostedUiDomain}/oauth2/token`,
  };
}

/** Expo Go's redirect. Never a registered Cognito callback, on any client. */
function isExpoGoRedirect(uri: string): boolean {
  return uri.startsWith("exp://") || uri.startsWith("exp+");
}

export async function signInWithPkce(): Promise<StoredSession> {
  const { hostedUiDomain } = config.cognito;
  const clientId = pkceClientId();

  const missing: string[] = [];
  if (!hostedUiDomain) missing.push("EXPO_PUBLIC_COGNITO_HOSTED_UI_DOMAIN");
  if (!clientId) missing.push("EXPO_PUBLIC_COGNITO_WEB_CLIENT_ID / _MOBILE_CLIENT_ID");
  if (missing.length > 0) {
    throw new AuthError("errors.configMissing", { keys: missing.join(", ") });
  }

  // On web the scheme is ignored and this resolves to `${window.location.origin}/callback`
  // — which is exactly the web client's registered callback when served on port 5173.
  const redirectUri = makeRedirectUri({ scheme: "crewsafe", path: "callback" });

  if (isExpoGoRedirect(redirectUri)) {
    throw new AuthError("auth.cognito.pkceUnavailableInExpoGo");
  }

  const discovery = discoveryFor(hostedUiDomain);

  const request = new AuthRequest({
    clientId,
    redirectUri,
    // Matches `allowed_oauth_scopes` on both clients. Asking for a scope the client does
    // not allow fails the authorize request outright.
    scopes: ["openid", "email", "profile"],
    // Authorization code + PKCE. Never an implicit flow: that puts tokens in the URL
    // fragment, where they land in browser history and referrer headers.
    responseType: "code",
    usePKCE: true,
  });

  const result = await request.promptAsync(discovery);

  if (result.type === "cancel" || result.type === "dismiss") {
    throw new AuthError("auth.cognito.cancelled");
  }
  if (result.type !== "success") {
    throw new AuthError("errors.server");
  }

  const code = result.params.code;
  if (!code) {
    throw new AuthError("errors.server");
  }

  let tokens;
  try {
    tokens = await exchangeCodeAsync(
      {
        clientId,
        code,
        redirectUri,
        // The PKCE secret. Generated per request by AuthRequest and never persisted —
        // it is what makes a public client safe without a client secret.
        extraParams: { code_verifier: request.codeVerifier ?? "" },
      },
      discovery,
    );
  } catch {
    throw new AuthError("errors.network");
  }

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    // Cognito always sends expires_in; the fallback matches the mobile client's one-hour
    // access token rather than guessing, so a missing field degrades predictably.
    expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000,
  };
}
