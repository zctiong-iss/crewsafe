/// <reference types="vite/client" />
/**
 * @author Jemilin Beulah
 */

interface ImportMetaEnv {
  readonly VITE_COGNITO_AUTHORITY: string;
  readonly VITE_COGNITO_CLIENT_ID: string;
  /** The Hosted UI base URL, e.g. https://xxxxxxxxxxxx.auth.ap-southeast-1.amazoncognito.com — a different host from VITE_COGNITO_AUTHORITY. Used to build the logout redirect; see authConfig.ts. */
  readonly VITE_COGNITO_HOSTED_UI_DOMAIN: string;
  readonly VITE_REDIRECT_URI: string;
  readonly VITE_POST_LOGOUT_REDIRECT_URI?: string;
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
