/**
 * Stand-in for the trained-model WBGT forecast (SCRUM-362 / US-06).
 *
 * ── THE BACKEND FOR THIS IS REAL ────────────────────────────────────────────────────────
 * Unlike `conditions.ts`, this mock is not covering for a missing endpoint. PR #222
 * (SCRUM-281) landed `GET /api/v1/sites/{siteId}/weather/forecast?horizonMinutes=30|60` on
 * main, site-authorized by `@siteAccess.canAccess`, answering `SiteForecast`. This exists
 * only so `mock` auth mode — which never touches the network — still has something to draw,
 * and so the states below stay reviewable without a live ML service and two hours of
 * cadence-perfect NEA history behind it.
 *
 * ── WHY UNAVAILABLE IS A SCENARIO AND NOT AN ERROR ──────────────────────────────────────
 * `SiteForecastService` refuses to guess. It throws `ForecastUnavailableException` → 503 when
 * there is no recent weather, when the latest row has no WBGT, when there are fewer than two
 * rows, when the station id is missing or changes inside the two-hour window, when quality is
 * SIMULATED or the classifier says STALE, and when any spacing is off the exact 15-minute
 * cadence. That strictness is correct — a model fed stale input would produce a confident
 * number about nothing — but it makes 503 an *ordinary* answer rather than a fault.
 *
 * Note the interaction worth knowing about when testing by hand: the freshness switcher
 * defaults to SIMULATED, which on a live backend is itself one of the refusal conditions. So
 * against a real server the honest default answer for a demo site is "unavailable".
 *
 * ── NO BAND HERE, DELIBERATELY ──────────────────────────────────────────────────────────
 * `conditions.ts` reproduces §7.1's band matrix because it is standing in for a server that
 * would evaluate one. This file must not: the real `SiteForecast` carries no band, and
 * inventing one here would put the mock ahead of the contract and quietly teach the screen
 * to expect a field that never arrives. SCRUM-369 adds it server-side.
 *
 * @author Justin Chua
 */
import type { ForecastHorizonMinutes, SiteForecast } from "@/types/domain";
import { getForecastScenario } from "./scenario";

/** Matches `mockConditions`, so the forecast reads as a continuation of the same weather. */
const OBSERVED_WBGT = 32.4;

/**
 * The bundle identifier the trained pipeline stamps on its output.
 *
 * `-MOCK` suffixed for the same reason `policyVersion` is in `conditions.ts`: a screenshot of
 * a demo build should never be mistakable for evidence about a real model's behaviour.
 */
const MODEL_VERSION = "wbgt-lgbm-2026.02-MOCK";

/**
 * Thrown for the `unavailable` scenario, standing in for the backend's 503.
 *
 * Carries no cause detail on purpose. The real handler logs `forecast_dependency_unavailable`
 * server-side and answers the client a flat "Forecast temporarily unavailable" — which of the
 * seven conditions tripped is not something a supervisor can act on, and naming stations or
 * cadence gaps in the UI would be noise dressed as precision.
 */
export class MockForecastUnavailable extends Error {
  constructor() {
    super("Forecast temporarily unavailable");
    this.name = "MockForecastUnavailable";
  }
}

/**
 * Drift per horizon, in °C.
 *
 * Rising, and further at 60 than at 30, because a forecast that never moves off the observed
 * reading demonstrates nothing — the whole point of the screen is the case where acting early
 * differs from acting late. These are shaped to look like a warming afternoon, not derived
 * from anything; the real numbers come from the trained model.
 */
const DRIFT: Record<ForecastHorizonMinutes, number> = { 30: 0.4, 60: 0.9 };

/**
 * Half-width of the interval, in °C.
 *
 * Widening with the horizon is the one property here that is not arbitrary: a model is less
 * certain further out, and an interval that stayed the same width at 60 minutes as at 30
 * would misrepresent the thing the interval exists to communicate.
 */
const SPREAD: Record<ForecastHorizonMinutes, number> = { 30: 0.3, 60: 0.6 };

/** The `wide` scenario multiplies the spread rather than replacing it, keeping it centred. */
const WIDE_MULTIPLIER = 4;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function mockForecast(horizonMinutes: ForecastHorizonMinutes): SiteForecast {
  if (getForecastScenario() === "unavailable") {
    throw new MockForecastUnavailable();
  }

  const predictedValue = round(OBSERVED_WBGT + DRIFT[horizonMinutes]);
  const spread =
    SPREAD[horizonMinutes] * (getForecastScenario() === "wide" ? WIDE_MULTIPLIER : 1);

  return {
    metric: "WBGT",
    predictedValue,
    horizonMinutes,
    modelVersion: MODEL_VERSION,
    confidenceIntervalLower: round(predictedValue - spread),
    confidenceIntervalUpper: round(predictedValue + spread),
    // The model's clock, not the app's request time. A forecast generated four minutes ago
    // and one generated forty are worth different amounts of trust, and only this field can
    // tell them apart.
    generatedAt: new Date(Date.now() - 60_000).toISOString(),
  };
}
