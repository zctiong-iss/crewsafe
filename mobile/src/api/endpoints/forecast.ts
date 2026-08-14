/**
 * The trained-model WBGT forecast for a site (SCRUM-362 / US-06).
 *
 * A real endpoint, landed on main by PR #222 (SCRUM-281) and authorized per site by
 * `@PreAuthorize("@siteAccess.canAccess(#siteId)")`. The FastAPI service behind it stays
 * private: this call returns a prediction, never the model bundle or the service address.
 *
 * @author Justin Chua
 */
import { request } from "../client";
import { isApiError } from "../errors";
import { isMockApi } from "@/auth/authMode";
import { mockForecast, MockForecastUnavailable } from "../mock/forecast";
import type { ForecastHorizonMinutes, SiteForecast } from "@/types/domain";

/**
 * Raised when the model declines to predict — the backend's 503.
 *
 * A distinct type rather than an `ApiError`, because callers must not treat this as a
 * failure. `SiteForecastService` refuses on seven conditions (no recent weather, no WBGT on
 * the latest row, fewer than two rows, a missing or changed station id, SIMULATED or STALE
 * quality, and any gap off the 15-minute cadence), several of which are routine on a quiet
 * site. Rendering that as an error would put a red banner over a weather screen that is
 * working perfectly, and would train supervisors to disregard banners that sometimes matter.
 *
 * Note what this deliberately does *not* do: add an `"unavailable"` kind to `ApiErrorKind`.
 * `api/errors.ts` is kept in parity with `web/src/api/errors.ts` so both clients reason about
 * the backend identically, and this story is React Native only — a mobile-only kind would
 * make that comment quietly false. Branching on `status === 503` keeps the taxonomy shared.
 */
export class ForecastUnavailableError extends Error {
  /** Present when the response carried one; worth quoting in a bug report. */
  readonly requestId: string | null;

  constructor(requestId: string | null = null) {
    super("Forecast temporarily unavailable");
    this.name = "ForecastUnavailableError";
    this.requestId = requestId;
  }
}

export function isForecastUnavailable(value: unknown): value is ForecastUnavailableError {
  return value instanceof ForecastUnavailableError;
}

/**
 * `GET /api/v1/sites/{siteId}/weather/forecast?horizonMinutes=30|60`.
 *
 * Rejects with {@link ForecastUnavailableError} on 503, and with the usual {@link ApiError}
 * on everything else — so a caller can tell "the model is declining" from "this is broken"
 * without inspecting status codes itself.
 *
 * `horizonMinutes` is a union, not a number: `ForecastController` answers 400 for any other
 * value, and that is a mistake better caught by the compiler than by the user.
 */
export async function fetchSiteForecast(
  siteId: string,
  horizonMinutes: ForecastHorizonMinutes,
): Promise<SiteForecast> {
  if (isMockApi()) {
    return new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(mockForecast(horizonMinutes));
        } catch (error) {
          reject(
            error instanceof MockForecastUnavailable
              ? new ForecastUnavailableError()
              : error,
          );
        }
      }, 250),
    );
  }

  try {
    return await request<SiteForecast>({
      url: `/api/v1/sites/${siteId}/weather/forecast`,
      method: "GET",
      params: { horizonMinutes },
    });
  } catch (error) {
    if (isApiError(error) && error.status === 503) {
      throw new ForecastUnavailableError(error.requestId);
    }
    throw error;
  }
}
