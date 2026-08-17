/** @author Tang Chee Seng (with assistance from Claude) */
import type { subscribeToConditions, WeatherFreshness, WbgtBand } from "@/api/conditionsStream";
import { useConditionsStream } from "@/features/conditions/useConditionsStream";
import { StopWorkBanner } from "@/features/conditions/StopWorkBanner";

/**
 * Freshness → label as a lookup, NOT a nested ternary (Sonar S3358). Typing it as a total
 * Record over the union means a new freshness value becomes a compile error, not a blank.
 */
const FRESHNESS_LABEL: Record<WeatherFreshness, string> = {
  LIVE: "Live",
  DELAYED: "Delayed",
  STALE: "Stale",
  SIMULATED: "Simulated",
};

/**
 * Band → label / colour-tone. DISPLAY ONLY — this is NOT a classifier. The band arrives
 * already decided by the server (WbgtBand.classify); these maps choose how to PAINT it.
 * Total Record over the union → a new band value is a compile error, never a silent blank.
 */
const BAND_LABEL: Record<WbgtBand, string> = {
  BELOW_31: "Low Heat Risk · <31 °C",
  "31_TO_BELOW_32": "Elevated Heat Risk · 31–32 °C",
  "32_TO_BELOW_33": "High Heat Risk · 32–33 °C",
  "33_AND_ABOVE": "Extreme Heat Risk · 33 °C+",
};
const BAND_TONE: Record<WbgtBand, "low" | "moderate" | "high" | "extreme"> = {
  BELOW_31: "low",
  "31_TO_BELOW_32": "moderate",
  "32_TO_BELOW_33": "high",
  "33_AND_ABOVE": "extreme",
};

// S6759: props are readonly. `subscribe` is injectable so tests drive the stream without a socket.
export function SiteConditionsSummary({
  siteId,
  subscribe,
}: Readonly<{ siteId: string; subscribe?: typeof subscribeToConditions }>) {
  const { snapshot, connectionState, stopWorkActive, rangeWarnings } = useConditionsStream(siteId, subscribe);

  // First paint, nothing has arrived. S6819: <output> is the accessible live-status element —
  // NOT <p role="status">.
  if (connectionState === "connecting" && snapshot === null) {
    return <output className="site-card__status">Connecting to live conditions…</output>;
  }

  // A fatal (auth) close. The session, not the site, is the problem — say so.
  if (connectionState === "closed") {
    return (
      <p className="site-card__status site-card__status--closed">
        Live feed unavailable. Sign in again to resume monitoring.
      </p>
    );
  }

  const c = snapshot?.conditions ?? null;                 // ?? not || (S6606)
  const lightning = snapshot?.lightning ?? null;
  const hasWbgtWarning = rangeWarnings.some((warning) => warning.metric === "wbgt");

  return (
    <div className="site-card__live">
      {/* Band-coloured risk spine down the card's left edge (absolute, full height, aria-hidden —
          the band chip carries the text, so this is pure scan-affordance). Neutral until a band arrives. */}
      <span
        className={`site-card__spine site-card__spine--${c?.currentBand ? BAND_TONE[c.currentBand] : "idle"}`}
        aria-hidden="true"
      />

      {/* Section header: the "Live conditions" label with freshness right beside it, up top where
          the eye lands after the worksite detail — trust signal before the reading, not after. */}
      <div className="site-card__meta">
        <span className="eyebrow">Live conditions</span>
        {c !== null && (
          <span className={`pill site-card__freshness site-card__freshness--${c.freshness.toLowerCase()}`}>
            {FRESHNESS_LABEL[c.freshness]}
          </span>
        )}
      </div>

      {stopWorkActive && lightning && <StopWorkBanner lightning={lightning} />}

      {connectionState === "degraded" && (
        <p className="site-card__degraded" role="alert">
          Live feed interrupted — showing last known reading.
        </p>
      )}

      {/* Single ternary (never nested): reading present, or an honest "no reading yet". */}
      {c === null ? (
        <p className="site-card__status">No weather reading for this site yet.</p>
      ) : (
        <div className="site-card__reading">
          <div className="site-card__wbgt">
            <span className="eyebrow">WBGT</span>
            <span className="site-card__wbgt-value">{c.wbgt} °C</span>
          </div>
          <div className="site-card__badges">
            {c.currentBand && (
              <span className={`pill site-card__band site-card__band--${BAND_TONE[c.currentBand]}`}>
                {BAND_LABEL[c.currentBand]}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 30-min forecast — value + band, only when the server had a forecast. Lighter than the live chip.
          The number renders under its own null-guard: a null band already hides the row, and this keeps
          "null °C" impossible even though a non-null band always ships with a non-null value. */}
      {c?.forecastBand && (
        <p className="site-card__forecast">
          <span className="eyebrow">Next 30 min Forecast:</span>
          <span className={`pill site-card__band site-card__band--forecast site-card__band--${BAND_TONE[c.forecastBand]}`}>
            {BAND_LABEL[c.forecastBand]}
          </span>
        </p>
      )}

      {hasWbgtWarning && (
        <p className="site-card__degraded" role="alert">
          Latest WBGT is outside the expected range — verify against official NEA data.
        </p>
      )}

      {snapshot?.activeShift && (
        <div className="site-card__footer">
          <p className="site-card__shift"><span aria-hidden="true">● </span>Active shift in progress</p>
        </div>
      )}
    </div>
  );
}