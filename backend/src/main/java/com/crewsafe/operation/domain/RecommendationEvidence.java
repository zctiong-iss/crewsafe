package com.crewsafe.operation.domain;

import com.crewsafe.lightning.domain.LightningRiskState;
import com.crewsafe.weather.domain.WbgtBand;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * What the agent actually saw when it drafted a plan (SCRUM-359, closing a gap raised from the
 * mobile analysis of SCRUM-118).
 *
 * <p>§12.2 requires every recommendation to surface the age of the data behind it, the model
 * version and the policy version. Without this record a supervisor could read a plan's prose
 * and its rule references and still have no way to check what reading produced it — and mobile
 * deriving the readings client-side at render time would be worse than nothing, because it
 * would show <em>current</em> conditions next to a plan drafted under different ones.
 *
 * <p><strong>This is a snapshot, not a view.</strong> Every field is the value as it was at
 * draft time and is never recomputed. That is the whole point: a plan drafted at 32.5°C stays
 * explainable an hour later when the site has cooled to 29°C, and an approval recorded against
 * it can be audited against the conditions that justified it rather than the conditions that
 * happen to hold when someone opens the screen.
 *
 * <p>Fields are nullable because degraded operation is a real state, not an error (§7.1). A site
 * with no weather observation at all can still receive a lightning stop-work plan, and that plan
 * should say honestly that it had no reading rather than carry a fabricated one.
 *
 * @author Abu Bakar
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RecommendationEvidence(
    /** WBGT at draft time, °C. Null when no observation existed for the site. */
    BigDecimal observedWbgt,

    /**
     * 30-minute WBGT forecast at draft time, °C.
     *
     * <p>A real SCRUM-281 prediction from {@code SiteForecastService} when enough recent, live,
     * single-station weather history exists for this site; the persistence baseline (equal to
     * {@code observedWbgt} by construction) otherwise — the site is new, its last reading is
     * stale or simulated, or ml-service itself was unreachable. Both are legitimate outcomes of
     * §7.1's degrade-not-fail rule, so this field being equal to {@code observedWbgt} is not by
     * itself evidence of anything; check {@code forecastBand} against {@code currentBand} if you
     * need to tell the two cases apart.
     */
    BigDecimal forecastWbgt30m,

    /** Band for {@code observedWbgt}, from the server-authoritative {@link WbgtBand#classify}. */
    WbgtBand currentBand,

    /** Band for {@code forecastWbgt30m}. Null when no forecast was available (§7.1). */
    WbgtBand forecastBand,

    /** When the underlying weather observation was taken — the "how old is this" of §12.2. */
    Instant observedAt,

    /** LIVE / DELAYED / STALE / SIMULATED, evaluated at draft time rather than at read time. */
    WeatherQualityStatus freshness,

    /** Where the reading came from, e.g. NEA or a fixture. */
    WeatherSource source,

    /** The weather station the reading came from. */
    String stationId,

    /** CLEAR / ADVISORY / STOP_WORK. Null when lightning has never been ingested for the site. */
    LightningRiskState lightningState
) {
}
