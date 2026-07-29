package com.crewsafe.identity.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * Links a user to a site they are allowed to access.
 *
 * This is the entity behind FR-03. Deliberately modelled with plain UUID columns rather
 * than {@code @ManyToOne} associations: the only questions ever asked of it are
 * "is this pair present?" and "which sites does this user have?", and keeping it free of
 * entity graphs means the authorization check stays a single indexed lookup with no
 * risk of lazy-loading surprises inside a security filter.
 *
 * @author Jemilin Beulah
 */
@Entity
@Table(name = "site_membership")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SiteMembership {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "site_id", nullable = false)
    private UUID siteId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public SiteMembership(UUID userId, UUID siteId) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.siteId = siteId;
    }

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
