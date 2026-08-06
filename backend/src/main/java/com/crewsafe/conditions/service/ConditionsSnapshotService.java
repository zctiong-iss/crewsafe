package com.crewsafe.conditions.service;

import com.crewsafe.conditions.api.ActiveShiftPayload;
import com.crewsafe.conditions.api.ConditionsPayload;
import com.crewsafe.conditions.api.ConditionsSnapshot;
import com.crewsafe.lightning.api.LightningRiskPayload;
import com.crewsafe.lightning.risk.LightningRiskDerivationService;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.ingestion.WeatherFreshnessClassifier;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

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

    private final WeatherObservationRepository observations;
    private final ShiftRepository shifts;
    private final WeatherFreshnessClassifier freshnessClassifier;
    private final LightningRiskDerivationService lightningRiskDerivationService;
    private final Clock clock;

    public ConditionsSnapshot getSnapshot(UUID siteId) {
        Instant asOf = Instant.now(clock);

        ConditionsPayload conditions = observations.findFirstBySiteIdOrderByObservedAtDesc(siteId)
                .map(observation -> toPayload(observation, asOf))
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
     * A {@code LIVE} reading from 40 minutes ago must show as {@code STALE} now, so freshness
     * is recomputed here rather than trusted from storage. {@code SIMULATED} is the one
     * exception — fixture data, not a function of age.
     */
    private ConditionsPayload toPayload(WeatherObservation observation, Instant asOf) {
        WeatherQualityStatus freshness = observation.getQualityStatus() == WeatherQualityStatus.SIMULATED
                ? WeatherQualityStatus.SIMULATED
                : freshnessClassifier.classify(observation.getObservedAt(), asOf);

        return new ConditionsPayload(observation.getWbgt(), observation.getTemperature(),
                observation.getHumidity(), observation.getWindSpeed(), observation.getRainfall(),
                observation.getObservedAt(), observation.getSource(), freshness);
    }

    private static ActiveShiftPayload toPayload(Shift shift) {
        return new ActiveShiftPayload(shift.getId(), shift.getStartsAt(), shift.getEndsAt());
    }
}
