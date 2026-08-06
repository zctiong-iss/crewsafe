package com.crewsafe.lightning.repository;

import com.crewsafe.lightning.domain.LightningObservation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Persistence boundary for ingested site lightning readings.
 *
 * @author Jemilin Beulah
 */
public interface LightningObservationRepository extends JpaRepository<LightningObservation, UUID> {

    Optional<LightningObservation> findFirstBySiteIdOrderByObservedAtDesc(UUID siteId);

    /**
     * Rows within the risk-derivation lookback window, newest first. The derivation service
     * scans these for the most recent qualifying strike rather than trusting a single latest
     * row, since a closer or more recent strike may have landed on an earlier tick.
     */
    List<LightningObservation> findBySiteIdAndObservedAtGreaterThanEqualOrderByObservedAtDesc(
            UUID siteId, Instant cutoff);

    /**
     * Atomically inserts one observation or reports that its logical identity already
     * exists, the same idempotency shape as {@code WeatherObservationRepository}.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query(value = """
            INSERT INTO lightning_observation (
                id, site_id, nearest_strike_km, nearest_strike_at,
                observed_at, ingested_at, source, quality_status
            ) VALUES (
                :id, :siteId, :nearestStrikeKm, :nearestStrikeAt,
                :observedAt, :ingestedAt, :source, :qualityStatus
            )
            ON CONFLICT (site_id, observed_at, source) DO NOTHING
            """, nativeQuery = true)
    int insertIfAbsent(
            @Param("id") UUID id,
            @Param("siteId") UUID siteId,
            @Param("nearestStrikeKm") BigDecimal nearestStrikeKm,
            @Param("nearestStrikeAt") Instant nearestStrikeAt,
            @Param("observedAt") Instant observedAt,
            @Param("ingestedAt") Instant ingestedAt,
            @Param("source") String source,
            @Param("qualityStatus") String qualityStatus
    );
}
