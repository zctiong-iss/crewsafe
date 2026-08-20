/**
 * The error taxonomy the UI branches on. Ported from `web/src/api/errors.ts` so both
 * clients reason about the same backend identically.
 *
 * The distinction that matters most is 401 versus 403:
 *
 *   401 — the *session* is not good. Sign the user out and send them to log in again.
 *   403 — the session is fine; this *user* may not do this. Stay signed in and explain.
 *
 * Conflating them means a supervisor who opens another site's shift gets logged out
 * mid-shift, loses what they were doing, and learns nothing about why.
 *
 * A `kind` says what shape the failure had; an optional `code` says what actually caused it.
 * Both exist because 409 alone cannot distinguish a lost write race from a site nobody has
 * configured a heat policy for, and those need opposite advice.
 *
 * @author Justin Chua
 */
export type ApiErrorKind =
  /** No valid session. The only kind that should ever trigger a sign-out. */
  | "unauthenticated"
  /** Authenticated, but not permitted. Never signs the user out. */
  | "forbidden"
  /** Authenticated with a real Cognito account that has no CrewSafe user row. */
  | "not-provisioned"
  | "not-found"
  /** Server-side validation failed. Carries `fieldErrors` when the server named fields. */
  | "bad-request"
  /** Lost a write race — the resource changed underneath us. */
  | "conflict"
  | "server"
  /** Request never completed — offline, DNS, refused, timed out. */
  | "network";

/**
 * Machine-readable reasons the backend may name alongside a status, mirroring
 * `ErrorCode.java`. Only codes this client actually branches on are listed; an unrecognised
 * one is not an error, it simply falls back to the status-derived message.
 */
export type ApiErrorCode =
  | "NO_ACTIVE_POLICY"
  | "NO_USABLE_WBGT"
  | "WORKER_HAS_OVERLAPPING_SHIFT"
  | "SHIFT_NOT_EDITABLE";

const KNOWN_ERROR_CODES = new Set([
  "NO_ACTIVE_POLICY",
  "NO_USABLE_WBGT",
  "WORKER_HAS_OVERLAPPING_SHIFT",
  "SHIFT_NOT_EDITABLE",
]);

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /**
   * The specific reason the server named, when it named one.
   *
   * Without this, both of `AgentDraftService`'s refusals reach the user as the generic 409
   * text — "Someone else changed this first. Reload and try again." — which is wrong advice
   * for a site that has no heat policy configured, because no amount of reloading creates
   * one. See `errors.codes.*` in the translation files.
   */
  readonly code: ApiErrorCode | null;
  /** The X-Request-Id the API issued, if the response carried one. Quote it in a bug report. */
  readonly requestId: string | null;
  /**
   * Per-field messages, when the server named fields.
   *
   * SCRUM-161 requires validation errors surfaced per field rather than as one generic
   * failure, so this survives all the way to `setError` on the form.
   */
  readonly fieldErrors: Record<string, string>;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null,
    requestId: string | null,
    fieldErrors: Record<string, string> = {},
    code: ApiErrorCode | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.requestId = requestId;
    this.fieldErrors = fieldErrors;
    this.code = code;
  }
}

/** Narrows a raw `code` off the wire to one this client has a translation for. */
export function toApiErrorCode(value: unknown): ApiErrorCode | null {
  return typeof value === "string" && KNOWN_ERROR_CODES.has(value)
    ? (value as ApiErrorCode)
    : null;
}

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status >= 400 && status < 500) return "bad-request";
  return "server";
}

/**
 * The i18n key for what a user should be told — never the raw server message, which is
 * deliberately vague (the API answers 401 identically for every cause so a caller cannot
 * probe which accounts exist).
 *
 * Returning a key rather than a string is what keeps every error message translatable.
 * Call it as `t(messageKeyFor(error))`.
 *
 * A named `code` wins over the status-derived key, because the status alone describes the
 * shape of the failure and the code describes the cause. `kind` remains the fallback, so an
 * older backend — or a code this build has no translation for — behaves exactly as before.
 */
export function messageKeyFor(error: ApiError): string {
  if (error.code) return `errors.codes.${error.code}`;
  return `errors.${error.kind}`;
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
