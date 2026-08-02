/**
 * Build-time configuration, read once.
 *
 * Every value must be referenced as a literal `process.env.EXPO_PUBLIC_*` member expression.
 * Metro inlines these at bundle time by static text substitution — it does not build a real
 * environment object — so `process.env[name]` resolves to `undefined` at runtime no matter
 * what `name` holds. That failure is silent and looks exactly like a missing `.env`, which
 * is why the lookups below are spelled out one by one instead of being generated in a loop.
 */
import { IS_WEB } from "./constants";

/** See `.env.example` for what each mode costs and where it works. */
export type AuthMode = "mock" | "cognito-password" | "cognito-pkce";

const AUTH_MODES: readonly AuthMode[] = ["mock", "cognito-password", "cognito-pkce"];

function readAuthMode(): AuthMode {
  const raw = process.env.EXPO_PUBLIC_AUTH_MODE;
  if (raw && (AUTH_MODES as readonly string[]).includes(raw)) {
    return raw as AuthMode;
  }
  // An unrecognised mode falls back to the safest one rather than throwing. A typo in
  // `.env` should not brick the app on a device you cannot open a console on.
  return "mock";
}

/**
 * Trailing slashes are stripped so `${baseUrl}/api/v1/me` cannot become a double slash.
 * Spring routes `//api` to a 404, which reads like a missing endpoint rather than a
 * misconfigured base URL, and that is an hour nobody gets back.
 */
function normaliseBaseUrl(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

export const config = {
  apiBaseUrl: normaliseBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL),
  authMode: readAuthMode(),

  cognito: {
    region: process.env.EXPO_PUBLIC_COGNITO_REGION ?? "ap-southeast-1",
    issuerUri: process.env.EXPO_PUBLIC_COGNITO_ISSUER_URI ?? "",
    hostedUiDomain: process.env.EXPO_PUBLIC_COGNITO_HOSTED_UI_DOMAIN ?? "",
    cliClientId: process.env.EXPO_PUBLIC_COGNITO_CLI_CLIENT_ID ?? "",
    webClientId: process.env.EXPO_PUBLIC_COGNITO_WEB_CLIENT_ID ?? "",
    mobileClientId: process.env.EXPO_PUBLIC_COGNITO_MOBILE_CLIENT_ID ?? "",
  },
} as const;

/**
 * Which Cognito app client the PKCE flow should use.
 *
 * On Expo web we are on `http://localhost:5173`, which is already a registered callback on
 * the *web* client — so PKCE works there today with no infrastructure change. A native
 * build redirects to `crewsafe://callback`, which belongs to the *mobile* client. Picking
 * the wrong one is a `redirect_mismatch` from Cognito with no further explanation.
 */
export function pkceClientId(): string {
  return IS_WEB ? config.cognito.webClientId : config.cognito.mobileClientId;
}

/** Missing configuration, named. Surfaced on the sign-in screen instead of at redirect time. */
export function missingConfigKeys(mode: AuthMode): string[] {
  const missing: string[] = [];
  if (!config.apiBaseUrl) missing.push("EXPO_PUBLIC_API_BASE_URL");

  if (mode === "cognito-password") {
    if (!config.cognito.issuerUri) missing.push("EXPO_PUBLIC_COGNITO_ISSUER_URI");
    if (!config.cognito.cliClientId) missing.push("EXPO_PUBLIC_COGNITO_CLI_CLIENT_ID");
  }

  if (mode === "cognito-pkce") {
    if (!config.cognito.issuerUri) missing.push("EXPO_PUBLIC_COGNITO_ISSUER_URI");
    if (!config.cognito.hostedUiDomain) missing.push("EXPO_PUBLIC_COGNITO_HOSTED_UI_DOMAIN");
    if (!pkceClientId()) {
      missing.push(
        IS_WEB ? "EXPO_PUBLIC_COGNITO_WEB_CLIENT_ID" : "EXPO_PUBLIC_COGNITO_MOBILE_CLIENT_ID",
      );
    }
  }

  return missing;
}
