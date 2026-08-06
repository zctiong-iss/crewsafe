package com.crewsafe.lightning.domain;

import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
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
 * One site's nearest-strike reading for one ingestion tick. {@code nearestStrikeKm} and
 * {@code nearestStrikeAt} are both {@code null} when NEA reported no strikes that tick — a
 * valid outcome, not a missing value. {@link LightningRiskState} is never stored here; it is
 * derived at read time from a window of these rows, the same way weather freshness is
 * recomputed rather than trusted from storage.
 *
 * @author Jemilin Beulah
 */
@Entity
@Table(name = "lightning_observation")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LightningObservation {

    @Id
    private UUID id;

    @Column(name = "site_id", nullable = false)
    private UUID siteId;

    @Column(name = "nearest_strike_km", precision = 6, scale = 2)
    private BigDecimal nearestStrikeKm;

    @Column(name = "nearest_strike_at")
    private Instant nearestStrikeAt;

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
}
