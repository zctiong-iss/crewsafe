/**
 * @author Jemilin Beulah
 */
import { WebStorageStateStore, type UserManagerSettings } from "oidc-client-ts";

/**
 * Reads the Cognito settings Vite injected at build time.
 *
 * These are not secrets — the client id and pool id travel in every authorize redirect, in
 * the browser's address bar. They are configuration because they differ per environment,
 * not because they are sensitive. The real secret in this flow is the PKCE code verifier,
 * which oidc-client-ts generates per login and never persists anywhere we choose.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    // Fail at startup with the variable name rather than at redirect time with an opaque
    // Cognito error page. A missing authority otherwise surfaces as "invalid_request".
    throw new Error(
      `Missing ${name}. Copy web/.env.example to web/.env.local and fill it in.`,
    );
  }
  return value;
}

const hostedUiDomain = required(
  "VITE_COGNITO_HOSTED_UI_DOMAIN",
  import.meta.env.VITE_COGNITO_HOSTED_UI_DOMAIN,
);

export const authConfig: UserManagerSettings = {
  authority: required("VITE_COGNITO_AUTHORITY", import.meta.env.VITE_COGNITO_AUTHORITY),
  client_id: required("VITE_COGNITO_CLIENT_ID", import.meta.env.VITE_COGNITO_CLIENT_ID),
  redirect_uri: required("VITE_REDIRECT_URI", import.meta.env.VITE_REDIRECT_URI),
  post_logout_redirect_uri: import.meta.env.VITE_POST_LOGOUT_REDIRECT_URI,

  // Authorization Code + PKCE. Never "token" or "id_token token": an implicit flow puts
  // tokens in the URL fragment, where they land in browser history and referrer headers.
  response_type: "code",
  scope: "openid email profile",

  // jagregory/cognito-local's discovery document carries only issuer/jwks_uri — no
  // authorization_endpoint or token_endpoint, both required by the OIDC spec and by
  // oidc-client-ts to build a sign-in redirect at all. Real Cognito's discovery document
  // already has both, at exactly this hosted-UI-relative shape, so seeding them here is a
  // no-op against AWS (metadataSeed only fills what the fetched discovery didn't provide)
  // and the one thing that makes sign-in reachable against the local emulator.
  metadataSeed: {
    authorization_endpoint: `${hostedUiDomain}/oauth2/authorize`,
    token_endpoint: `${hostedUiDomain}/oauth2/token`,
    revocation_endpoint: `${hostedUiDomain}/oauth2/revoke`,
  },

  /*
   * sessionStorage, not localStorage.
   *
   * Both are readable by any script that achieves XSS, so neither is "safe" in the strict
   * sense. sessionStorage is the better of the two: it is scoped to one tab and cleared
   * when that tab closes, so a shared or unattended machine does not keep a live session
   * for the next person. localStorage would persist across tabs and restarts.
   *
   * In-memory only would be stronger still, but a page refresh mid-shift would force a
   * fresh login — a real cost on a console someone is using in the field. The compensating
   * controls are the enforcing CSP at the CloudFront SPA edge (script-src 'self', no
   * unsafe-inline — see infra/terraform/compute/web_security.tf) and 15-minute access
   * tokens. See ADR 0005.
   */
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  stateStore: new WebStorageStateStore({ store: window.sessionStorage }),

  // Renew silently before expiry so a supervisor mid-task is not bounced to a login page.
  automaticSilentRenew: true,
  // Cognito access tokens live 15 minutes; start renewing two minutes out.
  accessTokenExpiringNotificationTimeInSeconds: 120,
  // Bounds discovery, token, refresh and revocation requests. A network stall must not postpone mandatory local sign-out indefinitely.
  requestTimeoutInSeconds: 5,
  // oidc-client-ts filters auth_time by default, but the session policy needs that claim
  // to anchor the absolute eight-hour deadline. Keep filtering protocol-only claims that
  // the application does not use while deliberately retaining auth_time in the profile.
  filterProtocolClaims: ["nbf", "jti", "nonce", "acr", "amr", "azp", "at_hash"],
  // The app reads identity from GET /api/v1/me — the database is the authority on role and
  // site access, not the token. Fetching the userinfo endpoint as well would add a network
  // round trip for claims we deliberately do not trust.
  loadUserInfo: false,
};

export const apiBaseUrl: string = required(
  "VITE_API_BASE_URL",
  import.meta.env.VITE_API_BASE_URL,
);

/**
 * Cognito's own logout endpoint, built by hand rather than left to
 * {@link UserManager.signoutRedirect}.
 *
 * Cognito's discovery document advertises a standard OIDC `end_session_endpoint`, which
 * makes `signoutRedirect()` look like it should just work. It does not: Cognito's `/logout`
 * predates full RP-Initiated Logout support and ignores the standard
 * `post_logout_redirect_uri` / `id_token_hint` parameters that method sends. It wants its
 * own `client_id` and `logout_uri` instead, checked against the app client's "Sign out
 * URLs" — the same `logout_urls` set in infra/terraform/cognito. Without this, "sign out"
 * only clears this app's own tokens: Cognito's own session cookie survives, and clicking
 * sign in again on the same browser re-authenticates silently, no password prompt, no
 * matter who is now sitting at the machine.
 */
export function cognitoSignOutUrl(): string {
  const params = new URLSearchParams({
    client_id: authConfig.client_id,
    logout_uri: authConfig.post_logout_redirect_uri ?? window.location.origin,
  });
  return `${hostedUiDomain}/logout?${params.toString()}`;
}
