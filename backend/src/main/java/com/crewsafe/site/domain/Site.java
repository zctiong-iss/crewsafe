package com.crewsafe.site.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * A worksite. Latitude and longitude are used later to pick the nearest NEA weather
 * station and to evaluate lightning proximity.
 *
 * @author Jemilin Beulah
 */
@Entity
@Table(name = "site")
@Getter
@Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Site {

    @Id
    private UUID id;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(nullable = false, precision = 9, scale = 6)
    private BigDecimal latitude;

    @Column(nullable = false, precision = 9, scale = 6)
    private BigDecimal longitude;

    @Column(nullable = false, length = 64)
    private String timezone;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** Soft-removed by an admin. An archived site drops out of the normal site switcher, but
     * the row and its policy/shift history are kept — see {@code V21__site_archived.sql}. */
    @Column(nullable = false)
    private boolean archived;

    public Site(String name, BigDecimal latitude, BigDecimal longitude) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.latitude = latitude;
        this.longitude = longitude;
        this.timezone = "Asia/Singapore";
    }

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
