package com.crewsafe.shift.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * A block of work at a site, staffed by zero or more {@link ShiftAssignment}s.
 *
 * {@code siteId} is a plain UUID column rather than a {@code @ManyToOne}, the same choice
 * {@link com.crewsafe.identity.domain.SiteMembership} makes and for the same reason: the
 * only question ever asked of it is "which site", so an entity graph would add nothing but
 * lazy-loading risk.
 *
 * @author Abu Bakar
 */
@Entity
@Table(name = "shift")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Shift {

    @Id
    private UUID id;

    @Column(name = "site_id", nullable = false)
    private UUID siteId;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    @Column(name = "ends_at", nullable = false)
    private Instant endsAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ShiftStatus status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public Shift(UUID siteId, Instant startsAt, Instant endsAt) {
        this.id = UUID.randomUUID();
        this.siteId = siteId;
        this.startsAt = startsAt;
        this.endsAt = endsAt;
        this.status = ShiftStatus.PLANNED;
    }

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
