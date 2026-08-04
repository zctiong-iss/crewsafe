/**
 * Turning numbers into a picture.
 *
 * ── WHY THIS IS CLIENT-SIDE WHEN THE WBGT BAND IS NOT ───────────────────────────────────
 * `api/mock/conditions.ts` argues at length that the WBGT band must never be computed in
 * the app: FR-15 makes the backend engine authoritative, §12.2 forbids a client deciding a
 * risk band, and a second implementation would drift from the first on a decision that
 * makes people stop working.
 *
 * None of that applies here. This chooses an icon. Nothing downstream reads it, no
 * obligation follows from it, and if it disagreed with the backend by one category the
 * worst outcome is a cloud where a sun should be. Putting it in the mock would imply the
 * server owes us a field it does not have — the NEA ingestion (`weather/ingestion/`) stores
 * metrics, not a forecast string.
 *
 * If a real `GET /sites/{id}/conditions` later returns NEA's own forecast text ("Thundery
 * Showers", "Partly Cloudy (Day)"), prefer it and delete this: a published forecast beats
 * an inference from four numbers. Until then this is honest about being an inference.
 */
import type { SiteConditions, WeatherCondition } from "@/types/domain";

/**
 * Thresholds, as named constants rather than numbers buried in a branch.
 *
 * Chosen for Singapore, where humidity sits high year-round — an 80% reading is an ordinary
 * afternoon, not an overcast one, so the cloud thresholds are well above what they would be
 * in a temperate climate.
 */
const THRESHOLDS = {
  /** mm in the observation window. Anything at all means it is raining. */
  rainPresent: 0.2,
  /** Heavy rain. NEA reports thundery showers as the common heavy-rain case here. */
  rainHeavy: 10,
  /** km/h. Sustained wind worth showing as the headline condition. */
  windy: 25,
  cloudy: 88,
  partlyCloudy: 78,
} as const;

/**
 * Order matters: the first match wins, and the list runs from most consequential to least.
 * A thundery shower with high humidity is a thundery shower, not a cloudy day.
 */
export function classifyCondition(conditions: SiteConditions): WeatherCondition {
  const rain = conditions.rainfall ?? 0;
  const wind = conditions.windSpeed ?? 0;
  const humidity = conditions.humidity ?? 0;

  if (rain >= THRESHOLDS.rainHeavy) return "THUNDERY_SHOWERS";
  if (rain >= THRESHOLDS.rainPresent) return "RAIN";
  if (wind >= THRESHOLDS.windy) return "WINDY";
  if (humidity >= THRESHOLDS.cloudy) return "CLOUDY";
  if (humidity >= THRESHOLDS.partlyCloudy) return "PARTLY_CLOUDY";
  return "FAIR";
}

/**
 * Whether the observation was taken after dark, in Singapore time.
 *
 * Fixed hours rather than a sunrise/sunset calculation. Singapore is one degree off the
 * equator, so civil twilight moves by only a few minutes across the whole year — roughly
 * 07:00 to 19:15 — and a solar-position library would add a dependency to be more precise
 * than "is the sun up" needs to be for choosing between a sun and a moon.
 *
 * Derived from `observedAt`, not from now: the icon describes when the reading was taken.
 * A stale reading from before sunset should not acquire a moon because the worker happens
 * to be looking at it at 20:00.
 */
export function isNightObservation(observedAtIso: string): boolean {
  let hour: number;
  try {
    hour = Number(
      new Date(observedAtIso).toLocaleString("en-GB", {
        hour: "2-digit",
        hour12: false,
        timeZone: "Asia/Singapore",
      }),
    );
  } catch {
    hour = new Date(observedAtIso).getUTCHours() + 8; // SGT is UTC+8, no DST
  }

  const normalised = ((hour % 24) + 24) % 24;
  return normalised < 7 || normalised >= 19;
}
