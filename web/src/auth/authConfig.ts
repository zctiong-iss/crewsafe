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

// Pulled out as consts (rather than inline in authConfig) so the dev-only metadata override
// below can reference them.
const authority = required(
  "VITE_COGNITO_AUTHORITY",
  import.meta.env.VITE_COGNITO_AUTHORITY,
);
const hostedUiDomain = required(
  "VITE_COGNITO_HOSTED_UI_DOMAIN",
  import.meta.env.VITE_COGNITO_HOSTED_UI_DOMAIN,
);

/*
 * DEV-ONLY Cognito metadata override — for the local `cognito-local` emulator only.
 *
 * `cognito-local` is not a full OIDC provider, and two gaps break the discovery flow that
 * oidc-client-ts uses unchanged against real AWS Cognito:
 *
 *   1. Its /.well-known/openid-configuration omits `authorization_endpoint` and
 *      `token_endpoint`. Without `authorization_endpoint`, oidc-client-ts cannot even build
 *      the sign-in redirect URL — signinRedirect() throws and the UI shows
 *      "Could not reach the sign-in page."
 *   2. The tokens it mints carry `iss = http://cognito-local/<pool>`, which does NOT match
 *      the issuer its own discovery doc advertises (`http://localhost:9229/<pool>`). After
 *      the callback, oidc-client-ts would reject the id_token on that mismatch.
 *
 * Supplying `metadata` explicitly makes oidc-client-ts skip discovery and fixes both: we name
 * the endpoints ourselves, and set `issuer` to the value the token actually carries. Gated on
 * `import.meta.env.DEV` AND the presence of VITE_COGNITO_LOCAL_ISSUER (set only in
 * web/.env.local), so it is dead code in any production build — Vite tree-shakes it out, and
 * real AWS Cognito continues to use normal discovery.
 */
const localIssuer = import.meta.env.VITE_COGNITO_LOCAL_ISSUER as string | undefined;
const localMetadata: Partial<UserManagerSettings> =
  import.meta.env.DEV && localIssuer
    ? {
        metadata: {
          issuer: localIssuer,
          authorization_endpoint: `${hostedUiDomain}/oauth2/authorize`,
          token_endpoint: `${hostedUiDomain}/oauth2/token`,
          jwks_uri: `${authority}/.well-known/jwks.json`,
          end_session_endpoint: `${hostedUiDomain}/logout`,
        },
      }
    : {};

export const authConfig: UserManagerSettings = {
  authority,
  client_id: required("VITE_COGNITO_CLIENT_ID", import.meta.env.VITE_COGNITO_CLIENT_ID),
  redirect_uri: required("VITE_REDIRECT_URI", import.meta.env.VITE_REDIRECT_URI),
  post_logout_redirect_uri: import.meta.env.VITE_POST_LOGOUT_REDIRECT_URI,

  // Authorization Code + PKCE. Never "token" or "id_token token": an implicit flow puts
  // tokens in the URL fragment, where they land in browser history and referrer headers.
  response_type: "code",
  scope: "openid email profile",

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
   * controls are the strict CSP the API already serves and 15-minute access tokens. See
   * ADR 0005.
   */
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  stateStore: new WebStorageStateStore({ store: window.sessionStorage }),

  // Renew silently before expiry so a supervisor mid-task is not bounced to a login page.
  automaticSilentRenew: true,
  // Cognito access tokens live 15 minutes; start renewing two minutes out.
  accessTokenExpiringNotificationTimeInSeconds: 120,

  // The app reads identity from GET /api/v1/me — the database is the authority on role and
  // site access, not the token. Fetching the userinfo endpoint as well would add a network
  // round trip for claims we deliberately do not trust.
  loadUserInfo: false,

  // Dev-only override for cognito-local (an empty object in production — see the block
  // above). Spread last so it adds `metadata` without touching any field set above.
  ...localMetadata,
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
