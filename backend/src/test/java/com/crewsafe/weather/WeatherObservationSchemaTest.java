package com.crewsafe.weather;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Proves PostgreSQL, not a process-local check, enforces retry-safe weather ingestion. */
class WeatherObservationSchemaTest extends AbstractIntegrationTest {

    @Autowired
    private SiteRepository sites;

    @Autowired
    private WeatherObservationRepository observations;

    @Test
    void duplicateSiteTimeAndSourceIsIgnoredAtomically() {
        Site site = sites.save(new Site("Weather Schema Site " + UUID.randomUUID(),
                new BigDecimal("1.352100"), new BigDecimal("103.819800")));
        Instant observedAt = Instant.parse("2026-07-30T08:30:00Z");

        int first = insert(site.getId(), observedAt, new BigDecimal("31.20"));
        int duplicate = insert(site.getId(), observedAt, new BigDecimal("99.99"));

        assertThat(first).isEqualTo(1);
        assertThat(duplicate).isZero();
        WeatherObservation stored = observations.findFirstBySiteIdOrderByObservedAtDesc(site.getId())
                .orElseThrow();
        assertThat(stored.getWbgt()).isEqualByComparingTo("31.20");
        assertThat(stored.getSource()).isEqualTo(WeatherSource.NEA);
        assertThat(stored.getQualityStatus()).isEqualTo(WeatherQualityStatus.LIVE);
        assertThat(stored.getStationId()).isEqualTo("S124");
    }

    private int insert(UUID siteId, Instant observedAt, BigDecimal wbgt) {
        return observations.insertIfAbsent(
                UUID.randomUUID(), siteId, wbgt,
                new BigDecimal("29.10"), new BigDecimal("81.00"),
                new BigDecimal("4.00"), BigDecimal.ZERO,
                observedAt, Instant.parse("2026-07-30T09:00:00Z"),
                WeatherSource.NEA.name(), WeatherQualityStatus.LIVE.name(), "S124");
    }
}
