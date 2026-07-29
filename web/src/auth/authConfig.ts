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

export const authConfig: UserManagerSettings = {
  authority: required("VITE_COGNITO_AUTHORITY", import.meta.env.VITE_COGNITO_AUTHORITY),
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
};

export const apiBaseUrl: string = required(
  "VITE_API_BASE_URL",
  import.meta.env.VITE_API_BASE_URL,
);
