package com.crewsafe.weather.service;

import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.ingestion.WeatherFreshnessClassifier;
import com.crewsafe.weather.ingestion.WeatherIngestionProperties;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WeatherQueryServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-05T10:00:00Z");
    private static final UUID SITE_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");

    @Mock
    private WeatherObservationRepository observations;

    @Mock
    private WeatherObservation observation;

    private WeatherQueryService service;

    @BeforeEach
    void setUp() {
        WeatherIngestionProperties properties = new WeatherIngestionProperties();
        properties.setDelayedAfter(Duration.ofMinutes(20));
        properties.setStaleAfter(Duration.ofMinutes(45));
        service = new WeatherQueryService(
                observations,
                new WeatherFreshnessClassifier(properties),
                Clock.fixed(NOW, ZoneOffset.UTC));
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID))
                .thenReturn(Optional.of(observation));
    }

    @Test
    void recalculatesStoredLiveReadingAsStaleAfterAPollGap() {
        when(observation.getQualityStatus()).thenReturn(WeatherQualityStatus.LIVE);
        when(observation.getObservedAt()).thenReturn(NOW.minus(Duration.ofHours(1)));

        WeatherQueryService.LatestSiteWeather latest = service.findLatestForSite(SITE_ID)
                .orElseThrow();

        assertThat(latest.qualityStatus()).isEqualTo(WeatherQualityStatus.STALE);
    }

    @Test
    void keepsFixtureReadingSimulatedRegardlessOfItsAge() {
        when(observation.getQualityStatus()).thenReturn(WeatherQualityStatus.SIMULATED);

        WeatherQueryService.LatestSiteWeather latest = service.findLatestForSite(SITE_ID)
                .orElseThrow();

        assertThat(latest.qualityStatus()).isEqualTo(WeatherQualityStatus.SIMULATED);
    }
}
