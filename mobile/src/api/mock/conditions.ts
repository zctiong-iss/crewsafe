/**
 * Stand-in for site conditions and the policy verdict over them.
 *
 * ── MISSING BACKEND ─────────────────────────────────────────────────────────────────────
 * Half of this exists. `weather_observation` is a real table, populated by a real NEA
 * ingestion scheduler (`weather/ingestion/`), with `source`, `observed_at`, `ingested_at`
 * and `quality_status` already modelled exactly as FR-11 and FR-12 require. What is missing
 * is a controller: nothing in `backend/` exposes any of it. §12.1 of the project plan names
 * the endpoint, and it is unimplemented.
 *
 *   GET /api/v1/sites/{siteId}/conditions
 *   200 {
 *     "observation": { siteId, wbgt, temperature, humidity, windSpeed, rainfall,
 *                      observedAt, ingestedAt, source, qualityStatus, stationId },
 *     "policy":      { policyVersion, currentBand, forecastBand,
 *                      mandatoryActions[], advisoryActions[] }
 *   }
 *
 * Making it real is mostly wiring: a controller over `WeatherObservationRepository`,
 * site-scoped with the same `@PreAuthorize("@siteAccess.canAccess(#siteId)")` as
 * `SiteController`, plus the policy engine (FR-15) evaluating the band.
 *
 * ── WHY THE BAND ARITHMETIC IS HERE AND NOWHERE ELSE ─────────────────────────────────────
 * `evaluatePolicy` below reproduces §7.1's rule matrix. That is deliberately part of the
 * *mock server*, not a utility the UI can import. FR-15 makes the backend engine
 * authoritative and §12.2 states that no client may submit or override a WBGT risk band. If
 * this lived in `src/helpers/`, a screen would eventually call it directly and the app would
 * be deciding safety policy — quietly, and in a second place that drifts from the first.
 * Delete this file when the endpoint lands; delete nothing else.
 * ────────────────────────────────────────────────────────────────────────────────────────
 *
 * @author Justin Chua
 */
import type {
  Intensity,
  PolicyAction,
  PolicyEvaluation,
  SiteConditions,
  WbgtBand,
} from "@/types/domain";
import { getFreshnessScenario, getNightOverride, getWeatherMetrics } from "./scenario";

export interface MockConditionsResponse {
  observation: SiteConditions;
  policy: PolicyEvaluation;
}

/** §7.1's boundaries, as configuration records rather than magic numbers in a branch. */
const BANDS: { band: WbgtBand; min: number }[] = [
  { band: "33_AND_ABOVE", min: 33 },
  { band: "32_TO_BELOW_33", min: 32 },
  { band: "31_TO_BELOW_32", min: 31 },
  { band: "BELOW_31", min: Number.NEGATIVE_INFINITY },
];

function bandFor(wbgt: number): WbgtBand {
  return BANDS.find((entry) => wbgt >= entry.min)?.band ?? "BELOW_31";
}

function action(code: string, ruleReference: string, workerId: string): PolicyAction {
  return { code, appliesTo: [workerId], ruleReference };
}

function evaluatePolicy(wbgt: number, intensity: Intensity, workerId: string): PolicyEvaluation {
  const currentBand = bandFor(wbgt);
  const heavy = intensity === "HEAVY";

  const mandatory: PolicyAction[] = [];
  const advisory: PolicyAction[] = [];

  switch (currentBand) {
    case "BELOW_31":
      advisory.push(action("HYDRATE_REGULARLY", "HS-BASE-HYDRATE", workerId));
      advisory.push(action("SHADE_RECOVERY", "HS-BASE-SHADE", workerId));
      break;

    case "31_TO_BELOW_32":
      mandatory.push(action("HYDRATE_HOURLY", "HS-31-HYDRATE", workerId));
      advisory.push(action("RESCHEDULE_HEAVY_WORK", "HS-31-RESCHEDULE", workerId));
      advisory.push(action("SHADE_RECOVERY", "HS-BASE-SHADE", workerId));
      break;

    case "32_TO_BELOW_33":
      mandatory.push(action("HYDRATE_HOURLY", "HS-31-HYDRATE", workerId));
      // The ten-minute hourly rest is specific to heavy work in this band.
      if (heavy) mandatory.push(action("REST_10_MIN_HOURLY", "HS-32-HEAVY", workerId));
      advisory.push(action("SHADE_RECOVERY", "HS-BASE-SHADE", workerId));
      break;

    case "33_AND_ABOVE":
      mandatory.push(action("HYDRATE_HOURLY", "HS-31-HYDRATE", workerId));
      if (heavy) mandatory.push(action("REST_15_MIN_HOURLY", "HS-33-HEAVY", workerId));
      advisory.push(action("RESCHEDULE_HEAVY_WORK", "HS-31-RESCHEDULE", workerId));
      advisory.push(action("CLOSE_MONITORING", "HS-33-MONITOR", workerId));
      break;
  }

  return {
    policyVersion: "MOM-WBGT-2026.1-MOCK",
    currentBand,
    // A real forecast comes from the ML service (FR-13). Held one band warmer than current
    // so the "rising" case is visible without pretending to predict anything.
    forecastBand: bandFor(wbgt + 0.6),
    mandatoryActions: mandatory,
    advisoryActions: advisory,
  };
}

export function mockConditions(
  siteId: string,
  intensity: Intensity,
  workerId: string,
): MockConditionsResponse {
  const now = Date.now();
  const qualityStatus = getFreshnessScenario();

  /*
   * Observation age tracks the freshness label rather than being fixed.
   *
   * A reading marked STALE but timestamped four minutes ago is a contradiction the screen
   * would render happily and a reviewer would rightly not believe. The thresholds mirror
   * `application.yml`: WEATHER_DELAYED_AFTER 20m, WEATHER_STALE_AFTER 45m.
   */
  const ageMinutes =
    qualityStatus === "STALE" ? 52 : qualityStatus === "DELAYED" ? 26 : 4;

  const metrics = getWeatherMetrics();

  /*
   * The night scenario moves the observation timestamp rather than setting a flag.
   *
   * `isNightObservation` reads the hour of `observedAt` in Singapore time, so shifting the
   * timestamp is what actually exercises it — a boolean would let the screen render a moon
   * while the underlying helper still believed it was noon. 13:00 UTC is 21:00 SGT.
   */
  const observedAt = getNightOverride()
    ? (() => {
        const night = new Date();
        night.setUTCHours(13, 0, 0, 0);
        return night;
      })()
    : new Date(now - ageMinutes * 60_000);
  // Sits in the 32-to-below-33 band, which is where heavy work first attracts a mandatory
  // rest — the most informative default for a screen whose job is showing that.
  const wbgt = 32.4;

  return {
    observation: {
      siteId,
      wbgt,
      temperature: 33.8,
      humidity: metrics.humidity,
      windSpeed: metrics.windSpeed,
      rainfall: metrics.rainfall,
      observedAt: observedAt.toISOString(),
      ingestedAt: new Date(observedAt.getTime() + 60_000).toISOString(),
      source: "NEA",
      qualityStatus,
      stationId: "S121",
    },
    policy: evaluatePolicy(wbgt, intensity, workerId),
  };
}
