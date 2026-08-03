/**
 * Which sign-in modes may be used, and where.
 *
 * `cognito-password` sends a raw password from the app to Cognito's InitiateAuth. That is
 * precisely what the Hosted UI + PKCE flow exists to avoid — the app should never see a
 * credential (ADR 0002, ADR 0004) — and it is only tolerable here because Expo Go cannot
 * complete a `crewsafe://callback` redirect, so without it there is no way to hold a real
 * Cognito token on a phone during development.
 *
 * That trade is acceptable in development and not in a shipped app, so it is enforced
 * rather than documented: `assertModeAllowed` throws outside `__DEV__`. `mock` is fenced
 * the same way for the more obvious reason that it authenticates nobody.
 */
import { config, type AuthMode } from "@/constants/config";
import { AuthError } from "./AuthError";

/** Modes that must never run in a release bundle. */
const DEV_ONLY_MODES: readonly AuthMode[] = ["mock", "cognito-password"];

export function isDevOnlyMode(mode: AuthMode): boolean {
  return DEV_ONLY_MODES.includes(mode);
}

/**
 * Throws if the configured mode is not permitted in this bundle.
 *
 * Called at the start of every sign-in rather than once at startup, so that no code path —
 * a deep link, a retry, a future background refresh — can reach a dev-only flow by
 * skipping an initialisation step.
 */
export function assertModeAllowed(mode: AuthMode): void {
  if (isDevOnlyMode(mode) && !__DEV__) {
    throw new AuthError("errors.configMissing", { keys: `AUTH_MODE=${mode}` });
  }
}

/*
 * The active mode is a module variable seeded from `.env`, not a constant, so the dev-only
 * selector on the sign-in screen can switch flows without a rebuild.
 *
 * It is held here rather than in Redux to avoid a cycle: the store imports the auth slice,
 * which imports `signIn`, which imports this module. Reading the store from here would
 * close that loop.
 *
 * The consequence is that a switch lasts until the next reload, after which `.env` wins
 * again. That is the right default for a debugging aid — a mode silently surviving a
 * reload is how you end up wondering why the app is not calling the backend.
 */
let activeMode: AuthMode = config.authMode;

export function getAuthMode(): AuthMode {
  return activeMode;
}

/** No-op outside `__DEV__`: a release build uses exactly what it was built with. */
export function setAuthMode(mode: AuthMode): void {
  if (!__DEV__) return;
  activeMode = mode;
}

/** True when the app should serve its own fixtures instead of calling the backend. */
export function isMockApi(): boolean {
  return getAuthMode() === "mock";
}
