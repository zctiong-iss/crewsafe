package com.crewsafe.conditions.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.crewsafe.conditions.api.ActiveShiftPayload;
import com.crewsafe.conditions.api.ConditionsPayload;
import com.crewsafe.conditions.api.ConditionsSnapshot;
import com.crewsafe.forecast.service.ForecastUnavailableException;
import com.crewsafe.forecast.service.SiteForecastService;
import com.crewsafe.forecast.service.SiteForecastService.SiteForecast;
import com.crewsafe.lightning.api.LightningRiskPayload;
import com.crewsafe.lightning.risk.LightningRiskDerivationService;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.weather.domain.WbgtBand;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.ingestion.WeatherFreshnessClassifier;
import com.crewsafe.weather.repository.WeatherObservationRepository;

import lombok.RequiredArgsConstructor;

/**
 * Combines the latest weather observation with the active shift for a site into one
 * conditions-screen payload. Plain and synchronous — {@link SiteConditionsStreamService}
 * is what turns repeated calls into a push stream.
 *
 * @author Jemilin Beulah
 */
@Service
@RequiredArgsConstructor
public class ConditionsSnapshotService {

    private static final int FORECAST_HORIZON_MINUTES = 30;

    private final WeatherObservationRepository observations;
    private final ShiftRepository shifts;
    private final WeatherFreshnessClassifier freshnessClassifier;
    private final LightningRiskDerivationService lightningRiskDerivationService;
    private final SiteForecastService siteForecastService;
    private final Clock clock;

    public ConditionsSnapshot getSnapshot(UUID siteId) {
        Instant asOf = Instant.now(clock);

        BigDecimal forecastWbgt = resolveForecastWbgt(siteId);

        ConditionsPayload conditions = observations.findFirstBySiteIdOrderByObservedAtDesc(siteId)
                .map(observation -> toPayload(observation, asOf, forecastWbgt))
                .orElse(null);


        LightningRiskPayload lightning = lightningRiskDerivationService
                .deriveForSite(siteId, asOf)
                .orElse(null);

        ActiveShiftPayload activeShift = shifts.findFirstBySiteIdAndStatusOrderByStartsAtDesc(
                        siteId, ShiftStatus.ACTIVE)
                .map(ConditionsSnapshotService::toPayload)
                .orElse(null);

        return new ConditionsSnapshot(siteId, conditions, lightning, activeShift, asOf);
    }

    /**
     * The 30-min forecast is best-effort enrichment for the card. When the site has no usable
     * reading, {@link SiteForecastService#forecast} throws {@link ForecastUnavailableException} —
     * that must NOT blank the whole conditions snapshot (WBGT, band, lightning), so we degrade it
     * to "no forecast" (null band, no chip) and keep the live reading flowing.
     */
    private BigDecimal resolveForecastWbgt(UUID siteId) {
        try {
            return siteForecastService.forecast(siteId, FORECAST_HORIZON_MINUTES)
                    .map(SiteForecast::predictedValue)
                    .orElse(null);
        } catch (ForecastUnavailableException ex) {
            return null;
        }
    }

    /**
     * A {@code LIVE} reading from 40 minutes ago must show as {@code STALE} now, so freshness
     * is recomputed here rather than trusted from storage. {@code SIMULATED} is the one
     * exception — fixture data, not a function of age.
     */
        private ConditionsPayload toPayload(WeatherObservation observation, Instant asOf, BigDecimal forecastWbgt) {
        WeatherQualityStatus freshness = observation.getQualityStatus() == WeatherQualityStatus.SIMULATED
                ? WeatherQualityStatus.SIMULATED
                : freshnessClassifier.classify(observation.getObservedAt(), asOf);

        return new ConditionsPayload(
                observation.getWbgt(),
                WbgtBand.classify(observation.getWbgt()),   // server-authoritative, same call as RecommendationEvidence
                WbgtBand.classify(forecastWbgt),            // null forecast → null band, never defaulted
                forecastWbgt,                               // raw 30-min forecast value, shown beside the band chip
                observation.getTemperature(), observation.getHumidity(),
                observation.getWindSpeed(), observation.getRainfall(),
                observation.getObservedAt(), observation.getSource(), freshness);
    }


    private static ActiveShiftPayload toPayload(Shift shift) {
        return new ActiveShiftPayload(shift.getId(), shift.getStartsAt(), shift.getEndsAt());
    }
}