package com.crewsafe.weather.ingestion;

import com.crewsafe.weather.domain.WeatherQualityStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;

/** Classifies WBGT age using the configured live/delayed/stale boundaries. */
@Component
@RequiredArgsConstructor
public class WeatherFreshnessClassifier {

    private final WeatherIngestionProperties properties;

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
