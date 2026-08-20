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

    /**
     * The highest WBGT observed at a site within {@code [from, to)} — the peak-heat figure the
     * SCRUM-139 close-out summary classifies into a band. Half-open to match every other window in
     * the codebase. Returns {@code null} when the window holds no observation (a real "no reading",
     * not a low reading), which the summary renders as an absent band rather than the coolest one.
     */
    @Query("""
            SELECT MAX(w.wbgt) FROM WeatherObservation w
            WHERE w.siteId = :siteId AND w.observedAt >= :from AND w.observedAt < :to
            """)
    BigDecimal findMaxWbgt(@Param("siteId") UUID siteId,
            @Param("from") Instant from, @Param("to") Instant to);

    /** Non-null WBGT readings for a site in chronological order within {@code [from, to)}. */
    @Query("""
            SELECT w FROM WeatherObservation w
            WHERE w.siteId = :siteId
              AND w.observedAt >= :from
              AND w.observedAt < :to
              AND w.wbgt IS NOT NULL
            ORDER BY w.observedAt ASC
            """)
    List<WeatherObservation> findWbgtHistory(
            @Param("siteId") UUID siteId,
            @Param("from") Instant from,
            @Param("to") Instant to);

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

    /** Fields for {@link #insertIfAbsent}, grouped so the method stays under Sonar's parameter limit. */
    record InsertObservationCommand(
            UUID id,
            UUID siteId,
            BigDecimal wbgt,
            BigDecimal temperature,
            BigDecimal humidity,
            BigDecimal windSpeed,
            BigDecimal rainfall,
            Instant observedAt,
            Instant ingestedAt,
            String source,
            String qualityStatus,
            String stationId
    ) {
    }

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
                :#{#command.id}, :#{#command.siteId}, :#{#command.wbgt}, :#{#command.temperature},
                :#{#command.humidity}, :#{#command.windSpeed}, :#{#command.rainfall},
                :#{#command.observedAt}, :#{#command.ingestedAt}, :#{#command.source},
                :#{#command.qualityStatus}, :#{#command.stationId}
            )
            ON CONFLICT (site_id, observed_at, source) DO NOTHING
            """, nativeQuery = true)
    int insertIfAbsent(@Param("command") InsertObservationCommand command);
}
