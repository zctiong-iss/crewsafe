/**
 * One axios instance for the whole app.
 *
 * It exists so three things are impossible to forget: attaching the bearer token, turning
 * a failure into a typed {@link ApiError} rather than a raw axios error, and keeping hold
 * of the X-Request-Id so a user in the field can quote it when something breaks. Mirrors
 * `web/src/api/client.ts`.
 */
import axios, { AxiosError, type AxiosRequestConfig, type AxiosInstance } from "axios";
import { config } from "@/constants/config";
import { ApiError, kindForStatus } from "./errors";

declare module "axios" {
  export interface AxiosRequestConfig {
    /**
     * Suppresses the automatic sign-out on a 401 for this request only.
     *
     * Exactly one call needs it: `GET /api/v1/me` during session resolution. A 401 there
     * does not mean the session is dead — it is how a *valid* Cognito token belonging to
     * an account with no CrewSafe user row presents itself, because the API answers 401
     * identically for every cause so a caller cannot probe which accounts exist. Tearing
     * the session down would discard the token that the "not provisioned" screen's retry
     * depends on, and turn a recoverable state into a forced re-login.
     */
    skipSessionTeardown?: boolean;
  }
}

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Supplies the current access token, or null when there is no session.
 *
 * Injected rather than imported so the client never reaches into auth state directly —
 * which would make this module impossible to use from inside the auth slice without a
 * cycle, and impossible to test without a session.
 */
export type TokenProvider = () => Promise<string | null>;

let getToken: TokenProvider = async () => null;

export function setTokenProvider(provider: TokenProvider): void {
  getToken = provider;
}

/**
 * Called when the server rejects our token. Lets the auth slice tear the session down
 * without the client importing it.
 */
let onUnauthenticated: () => void = () => {};

export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

export const http: AxiosInstance = axios.create({
  baseURL: config.apiBaseUrl,
  // Long enough for a cold Spring container on a laptop, short enough that a worker on a
  // dead connection is told so rather than watching a spinner. NFR is p95 < 1s for reads.
  timeout: 15_000,
  headers: { Accept: "application/json" },
});

http.interceptors.request.use(async (request) => {
  const token = await getToken();
  if (token) {
    request.headers.set("Authorization", `Bearer ${token}`);
  }
  return request;
});

/**
 * The backend's error body is `{ error, message, requestId }` on every endpoint — see
 * `ErrorResponse.java` and the `ErrorResponse` schema in `docs/api/shift.yaml`. It does not
 * currently return per-field detail, so `fieldErrors` is populated only if a future
 * `errors` or `fieldErrors` object appears. Reading it defensively now means the day the
 * backend adds one, SCRUM-161's per-field requirement starts working with no client change.
 */
function extractFieldErrors(data: unknown): Record<string, string> {
  if (!data || typeof data !== "object") return {};

  const candidate =
    (data as Record<string, unknown>).fieldErrors ?? (data as Record<string, unknown>).errors;

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};

  const result: Record<string, string> = {};
  for (const [field, message] of Object.entries(candidate as Record<string, unknown>)) {
    if (typeof message === "string") result[field] = message;
  }
  return result;
}

function toApiError(error: unknown): ApiError {
  if (!axios.isAxiosError(error)) {
    return new ApiError("server", "Unexpected client failure", null, null);
  }

  const axiosError = error as AxiosError;

  // No response means the request never completed — offline, DNS, refused, timed out.
  // Deliberately not reported as a server error: nothing on the server has failed, and
  // "check your connection" is the useful thing to tell someone standing on a site.
  if (!axiosError.response) {
    return new ApiError("network", axiosError.message || "Request did not complete", null, null);
  }

  const { status, headers, data } = axiosError.response;
  const requestId = (headers?.[REQUEST_ID_HEADER] as string | undefined) ?? null;

  return new ApiError(
    kindForStatus(status),
    `HTTP ${status}`,
    status,
    requestId,
    extractFieldErrors(data),
  );
}

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const apiError = toApiError(error);

    /*
     * Only 401 tears the session down — never 403.
     *
     * 401 means the *session* is not good: the token is expired, revoked, or was issued by
     * a pool this backend does not trust. Nothing the user does in the app will fix it, so
     * they are signed out and sent to sign in again.
     *
     * 403 means the session is fine and this *user* may not do this one thing — a
     * supervisor opening another site's shift, a worker reaching a supervisor endpoint.
     * Signing them out would lose whatever they were doing and teach them nothing about
     * why. It surfaces as a message on the screen that asked, and they stay signed in.
     */
    const skip = axios.isAxiosError(error) && error.config?.skipSessionTeardown;
    if (apiError.kind === "unauthenticated" && !skip) {
      onUnauthenticated();
    }

    return Promise.reject(apiError);
  },
);

/** Every endpoint module goes through this, so the typed error contract holds everywhere. */
export async function request<T>(options: AxiosRequestConfig): Promise<T> {
  const response = await http.request<T>(options);
  return response.data;
}
