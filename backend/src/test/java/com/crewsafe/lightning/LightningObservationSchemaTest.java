package com.crewsafe.lightning;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.lightning.domain.LightningObservation;
import com.crewsafe.lightning.repository.LightningObservationRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves PostgreSQL, not a process-local check, enforces retry-safe lightning ingestion.
 *
 * @author Jemilin Beulah
 */
class LightningObservationSchemaTest extends AbstractIntegrationTest {

    @Autowired
    private SiteRepository sites;

    @Autowired
    private LightningObservationRepository observations;

    @Test
    void duplicateSiteTimeAndSourceIsIgnoredAtomically() {
        Site site = sites.save(new Site("Lightning Schema Site " + UUID.randomUUID(),
                new BigDecimal("1.352100"), new BigDecimal("103.819800")));
        Instant observedAt = Instant.parse("2026-07-30T08:30:00Z");
        Instant strikeAt = Instant.parse("2026-07-30T08:29:40Z");

        int first = insert(site.getId(), observedAt, strikeAt, new BigDecimal("6.40"));
        int duplicate = insert(site.getId(), observedAt, strikeAt, new BigDecimal("0.10"));

        assertThat(first).isEqualTo(1);
        assertThat(duplicate).isZero();
        LightningObservation stored = observations.findFirstBySiteIdOrderByObservedAtDesc(site.getId())
                .orElseThrow();
        assertThat(stored.getNearestStrikeKm()).isEqualByComparingTo("6.40");
        assertThat(stored.getNearestStrikeAt()).isEqualTo(strikeAt);
        assertThat(stored.getSource()).isEqualTo(WeatherSource.NEA);
        assertThat(stored.getQualityStatus()).isEqualTo(WeatherQualityStatus.LIVE);
    }

    @Test
    void aNullDistanceAndStrikeTimeIsAValidRow() {
        Site site = sites.save(new Site("Quiet Schema Site " + UUID.randomUUID(),
                new BigDecimal("1.352100"), new BigDecimal("103.819800")));
        Instant observedAt = Instant.parse("2026-07-30T08:30:00Z");

        int inserted = observations.insertIfAbsent(new LightningObservationRepository.InsertObservationCommand(
                UUID.randomUUID(), site.getId(), null, null,
                observedAt, Instant.parse("2026-07-30T09:00:00Z"),
                WeatherSource.NEA.name(), WeatherQualityStatus.LIVE.name()));

        assertThat(inserted).isEqualTo(1);
        assertThat(observations.findFirstBySiteIdOrderByObservedAtDesc(site.getId()))
                .get().satisfies(row -> {
                    assertThat(row.getNearestStrikeKm()).isNull();
                    assertThat(row.getNearestStrikeAt()).isNull();
                });
    }

    @Test
    void recentWindowQueryExcludesRowsOlderThanTheCutoff() {
        Site site = sites.save(new Site("Window Schema Site " + UUID.randomUUID(),
                new BigDecimal("1.352100"), new BigDecimal("103.819800")));
        Instant cutoff = Instant.parse("2026-07-30T08:30:00Z");
        insert(site.getId(), cutoff.minusSeconds(1), cutoff.minusSeconds(1), new BigDecimal("5.00"));
        insert(site.getId(), cutoff, cutoff, new BigDecimal("5.00"));
        insert(site.getId(), cutoff.plusSeconds(1), cutoff.plusSeconds(1), new BigDecimal("5.00"));

        List<LightningObservation> recent = observations
                .findBySiteIdAndObservedAtGreaterThanEqualOrderByObservedAtDesc(site.getId(), cutoff);

        assertThat(recent).extracting(LightningObservation::getObservedAt)
                .containsExactly(cutoff.plusSeconds(1), cutoff);
    }

    private int insert(UUID siteId, Instant observedAt, Instant strikeAt, BigDecimal distanceKm) {
        return observations.insertIfAbsent(new LightningObservationRepository.InsertObservationCommand(
                UUID.randomUUID(), siteId, distanceKm, strikeAt,
                observedAt, Instant.parse("2026-07-30T09:00:00Z"),
                WeatherSource.NEA.name(), WeatherQualityStatus.LIVE.name()));
    }
}
