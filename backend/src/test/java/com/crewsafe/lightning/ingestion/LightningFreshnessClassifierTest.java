package com.crewsafe.lightning.ingestion;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static com.crewsafe.weather.domain.WeatherQualityStatus.DELAYED;
import static com.crewsafe.weather.domain.WeatherQualityStatus.LIVE;
import static com.crewsafe.weather.domain.WeatherQualityStatus.STALE;
import static org.assertj.core.api.Assertions.assertThat;

/** @author Jemilin Beulah */
class LightningFreshnessClassifierTest {

    private static final Instant NOW = Instant.parse("2026-07-30T09:00:00Z");

    private LightningFreshnessClassifier classifier;

    @BeforeEach
    void setUp() {
        LightningIngestionProperties properties = new LightningIngestionProperties();
        properties.setDelayedAfter(Duration.ofMinutes(5));
        properties.setStaleAfter(Duration.ofMinutes(15));
        classifier = new LightningFreshnessClassifier(properties);
    }

    @Test
    void classifiesThroughTheConfiguredBoundaries() {
        assertThat(classifier.classify(NOW.minus(Duration.ofMinutes(5)), NOW)).isEqualTo(LIVE);
        assertThat(classifier.classify(NOW.minus(Duration.ofMinutes(6)), NOW)).isEqualTo(DELAYED);
        assertThat(classifier.classify(NOW.minus(Duration.ofMinutes(15)), NOW)).isEqualTo(DELAYED);
        assertThat(classifier.classify(NOW.minus(Duration.ofMinutes(16)), NOW)).isEqualTo(STALE);
    }

    @Test
    void smallClockSkewDoesNotMakeFreshDataStale() {
        assertThat(classifier.classify(NOW.plusSeconds(30), NOW)).isEqualTo(LIVE);
    }
}
