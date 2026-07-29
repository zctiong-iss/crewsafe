/**
 * @author Jemilin Beulah
 */
/**
 * The error taxonomy the UI branches on.
 *
 * The distinction that matters most is 401 versus 403, because treating them alike is the
 * classic bug in an authenticated SPA:
 *
 *   401 — the *session* is not good. Sign the user out and send them to log in again.
 *   403 — the session is fine; this *user* may not do this. Stay signed in and explain.
 *
 * Conflating them means a supervisor who opens another site's page gets logged out, loses
 * whatever they were doing, and learns nothing about why.
 */
export type ApiErrorKind =
  /** No valid session. The only kind that should ever trigger a sign-out. */
  | "unauthenticated"
  /** Authenticated, but not permitted. Never signs the user out. */
  | "forbidden"
  /** Authenticated with a real Cognito account that has no CrewSafe user row. */
  | "not-provisioned"
  | "not-found"
  | "bad-request"
  | "server"
  /** Request never completed — offline, DNS, CORS, server down. */
  | "network";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** The X-Request-Id the API issued, if the response carried one. */
  readonly requestId: string | null;

  constructor(kind: ApiErrorKind, message: string, status: number | null, requestId: string | null) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.requestId = requestId;
  }
}

/** What a user should be told. Never the raw server message, which is deliberately vague. */
export function messageFor(error: ApiError): string {
  switch (error.kind) {
    case "unauthenticated":
      return "Your session has ended. Sign in to continue.";
    case "not-provisioned":
      return "Your sign-in worked, but this account has not been set up for CrewSafe yet. Ask your site administrator to add you.";
    case "forbidden":
      return "You do not have access to this. If you think you should, ask your site administrator.";
    case "not-found":
      return "That page or record does not exist.";
    case "bad-request":
      return "That request was not valid.";
    case "network":
      return "Cannot reach CrewSafe. Check your connection and try again.";
    case "server":
      return "Something went wrong on our end. Try again in a moment.";
  }
}
