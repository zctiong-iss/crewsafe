package com.crewsafe.weather.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * A site-level environmental snapshot anchored to an NEA WBGT observation.
 *
 * <p>Plain {@code siteId} mapping is deliberate: ingestion writes one row per site and the
 * dashboard reads by site id. No entity graph is needed on either hot path.
 *
 * @author Bryan Phang
 */
@Entity
@Table(name = "weather_observation")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class WeatherObservation {

    @Id
    private UUID id;

    @Column(name = "site_id", nullable = false)
    private UUID siteId;

    @Column(precision = 5, scale = 2)
    private BigDecimal wbgt;

    @Column(precision = 5, scale = 2)
    private BigDecimal temperature;

    @Column(precision = 5, scale = 2)
    private BigDecimal humidity;

    @Column(name = "wind_speed", precision = 5, scale = 2)
    private BigDecimal windSpeed;

    @Column(precision = 7, scale = 2)
    private BigDecimal rainfall;

    @Column(name = "observed_at", nullable = false)
    private Instant observedAt;

    @Column(name = "ingested_at", nullable = false)
    private Instant ingestedAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 50)
    private WeatherSource source;

    @Enumerated(EnumType.STRING)
    @Column(name = "quality_status", nullable = false, length = 50)
    private WeatherQualityStatus qualityStatus;

    @Column(name = "station_id", length = 100)
    private String stationId;
}
