package com.crewsafe.weather.repository;

import com.crewsafe.weather.domain.WeatherObservation;
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

/** Persistence boundary for current and historical site weather observations. */
public interface WeatherObservationRepository extends JpaRepository<WeatherObservation, UUID> {

    Optional<WeatherObservation> findFirstBySiteIdOrderByObservedAtDesc(UUID siteId);

    /** Recent rows used to build the private ML service's ordered forecast context. */
    List<WeatherObservation> findTop9BySiteIdOrderByObservedAtDesc(UUID siteId);

    /**
     * A wider window than {@link #findTop9BySiteIdOrderByObservedAtDesc}, for the forecast
     * ladder.
     *
     * <p>Nine rows is exactly two hours at a perfect 15-minute cadence, which leaves no room for
     * a missed delivery: one absent reading and the window no longer holds enough history to
     * work with. Twenty-four rows covers the same two hours even when a third of the cycles are
     * missing, and lets the lower tiers reach back for a real observation when the model tier
     * cannot be satisfied at all.
     */
    List<WeatherObservation> findTop24BySiteIdOrderByObservedAtDesc(UUID siteId);

    /**
     * Atomically inserts one observation or reports that its logical identity already
     * exists. PostgreSQL's conflict handling makes this safe across threads and instances;
     * a check-then-save sequence could not provide that guarantee.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query(value = """
            INSERT INTO weather_observation (
                id, site_id, wbgt, temperature, humidity, wind_speed, rainfall,
                observed_at, ingested_at, source, quality_status, station_id
            ) VALUES (
                :id, :siteId, :wbgt, :temperature, :humidity, :windSpeed, :rainfall,
                :observedAt, :ingestedAt, :source, :qualityStatus, :stationId
            )
            ON CONFLICT (site_id, observed_at, source) DO NOTHING
            """, nativeQuery = true)
    int insertIfAbsent(
            @Param("id") UUID id,
            @Param("siteId") UUID siteId,
            @Param("wbgt") BigDecimal wbgt,
            @Param("temperature") BigDecimal temperature,
            @Param("humidity") BigDecimal humidity,
            @Param("windSpeed") BigDecimal windSpeed,
            @Param("rainfall") BigDecimal rainfall,
            @Param("observedAt") Instant observedAt,
            @Param("ingestedAt") Instant ingestedAt,
            @Param("source") String source,
            @Param("qualityStatus") String qualityStatus,
            @Param("stationId") String stationId
    );
}
