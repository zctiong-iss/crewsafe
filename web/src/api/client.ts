/**
 * @author Jemilin Beulah
 */
import { apiBaseUrl } from "@/auth/authConfig";
import { ApiError, type ApiErrorKind } from "./errors";

/**
 * Supplies the current access token, or null when there is no session.
 *
 * Injected rather than imported so that tests can drive the client without a UserManager,
 * and so the client never reaches into auth state directly.
 */
export type TokenProvider = () => Promise<string | null>;

let getToken: TokenProvider = async () => null;

export function setTokenProvider(provider: TokenProvider): void {
  getToken = provider;
}

export function currentAccessToken(): Promise<string | null> {
  return getToken();
}

const REQUEST_ID_HEADER = "X-Request-Id";

function kindFor(status: number): ApiErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status >= 400 && status < 500) return "bad-request";
  return "server";
}

/**
 * One fetch wrapper for the whole app.
 *
 * It exists so that three things are impossible to forget: attaching the bearer token,
 * turning a failure into a typed {@link ApiError} rather than a raw Response, and keeping
 * hold of the request id so a user can quote it when something breaks.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  } catch {
    // fetch only rejects when the request never completed — offline, DNS, CORS, refused.
    // Deliberately not reported as a server error: nothing on the server has failed, and
    // "check your connection" is the useful thing to tell someone in the field.
    throw new ApiError("network", "Request did not complete", null, null);
  }

  const requestId = response.headers.get(REQUEST_ID_HEADER);

  if (!response.ok) {
    // clone(): the body can only be read once, and messageFor's kind-based fallback must
    // still work even when the body isn't valid JSON or carries no code at all.
    const code: string | null = await response
      .clone()
      .json()
      .then((body: unknown) => (body && typeof body === "object" && "code" in body ? String(body.code) : null))
      .catch(() => null);
    throw new ApiError(kindFor(response.status), `HTTP ${response.status}`, response.status, requestId, code);
  }

  if (response.status === 204) return undefined as T;

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("server", "Response was not valid JSON", response.status, requestId);
  }
}
