package com.crewsafe.weather.service;

import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.ingestion.WeatherFreshnessClassifier;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.Optional;
import java.util.UUID;

/** Read-only weather queries used by the CrewSafe API. */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class WeatherQueryService {

    private final WeatherObservationRepository observations;
    private final WeatherFreshnessClassifier freshnessClassifier;
    private final Clock clock;

    /** Returns the newest stored conditions with freshness evaluated at query time. */
    public Optional<LatestSiteWeather> findLatestForSite(UUID siteId) {
        return observations.findFirstBySiteIdOrderByObservedAtDesc(siteId)
                .map(observation -> new LatestSiteWeather(
                        observation, currentQualityStatus(observation)));
    }

    private WeatherQualityStatus currentQualityStatus(WeatherObservation observation) {
        if (observation.getQualityStatus() == WeatherQualityStatus.SIMULATED) {
            return WeatherQualityStatus.SIMULATED;
        }
        return freshnessClassifier.classify(observation.getObservedAt(), clock.instant());
    }

    /** Stored readings plus the live/delayed/stale status effective right now. */
    public record LatestSiteWeather(
            WeatherObservation observation,
            WeatherQualityStatus qualityStatus) {
    }
}
