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

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
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
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.requestId = requestId;
    this.fieldErrors = fieldErrors;
  }
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
 */
export function messageKeyFor(error: ApiError): string {
  return `errors.${error.kind}`;
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
