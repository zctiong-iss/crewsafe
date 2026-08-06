package com.crewsafe.lightning.ingestion;

import com.crewsafe.weather.domain.WeatherQualityStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;

/**
 * Classifies lightning-batch age using the configured live/delayed/stale boundaries —
 * whether the feed itself is current, independent of the derived risk state's own validity
 * window (whether a past strike still holds the site in advisory/stop-work).
 *
 * @author Jemilin Beulah
 */
@Component
@RequiredArgsConstructor
public class LightningFreshnessClassifier {

    private final LightningIngestionProperties properties;

    public WeatherQualityStatus classify(Instant observedAt, Instant evaluatedAt) {
        if (observedAt == null || evaluatedAt == null) {
            throw new IllegalArgumentException("observedAt and evaluatedAt are required");
        }

        Duration age = Duration.between(observedAt, evaluatedAt);
        if (age.isNegative() || age.compareTo(properties.getDelayedAfter()) <= 0) {
            return WeatherQualityStatus.LIVE;
        }
        if (age.compareTo(properties.getStaleAfter()) <= 0) {
            return WeatherQualityStatus.DELAYED;
        }
        return WeatherQualityStatus.STALE;
    }
}
