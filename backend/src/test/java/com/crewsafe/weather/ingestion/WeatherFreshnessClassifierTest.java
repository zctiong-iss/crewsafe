package com.crewsafe.weather.ingestion;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static com.crewsafe.weather.domain.WeatherQualityStatus.DELAYED;
import static com.crewsafe.weather.domain.WeatherQualityStatus.LIVE;
import static com.crewsafe.weather.domain.WeatherQualityStatus.STALE;
import static org.assertj.core.api.Assertions.assertThat;

class WeatherFreshnessClassifierTest {

    private static final Instant NOW = Instant.parse("2026-07-30T09:00:00Z");

    private WeatherFreshnessClassifier classifier;

    @BeforeEach
    void setUp() {
        WeatherIngestionProperties properties = new WeatherIngestionProperties();
        properties.setDelayedAfter(Duration.ofMinutes(20));
        properties.setStaleAfter(Duration.ofMinutes(45));
        classifier = new WeatherFreshnessClassifier(properties);
    }

    @Test
    void classifiesThroughTheConfiguredBoundaries() {
        assertThat(classifier.classify(NOW.minus(Duration.ofMinutes(20)), NOW)).isEqualTo(LIVE);
        assertThat(classifier.classify(NOW.minus(Duration.ofMinutes(21)), NOW)).isEqualTo(DELAYED);
        assertThat(classifier.classify(NOW.minus(Duration.ofMinutes(45)), NOW)).isEqualTo(DELAYED);
        assertThat(classifier.classify(NOW.minus(Duration.ofMinutes(46)), NOW)).isEqualTo(STALE);
    }

    @Test
    void smallClockSkewDoesNotMakeFreshDataStale() {
        assertThat(classifier.classify(NOW.plusSeconds(30), NOW)).isEqualTo(LIVE);
    }
}
