package com.crewsafe.identity.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * An application user.
 *
 * Named {@code AppUser} rather than {@code User} because {@code user} is a reserved word in
 * PostgreSQL and {@code org.springframework.security.core.userdetails.User} already occupies
 * the obvious name.
 *
 * @author Jemilin Beulah
 */
@Entity
@Table(name = "app_user")
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class AppUser {

    @Id
    private UUID id;

    @Column(nullable = false, unique = true, length = 64)
    private String username;

    /**
     * The {@code sub} claim from this user's Cognito access token. How a validated token
     * is resolved back to a role and site memberships - see
     * {@link com.crewsafe.identity.security.CognitoJwtAuthenticationConverter}.
     */
    @Column(name = "cognito_sub", nullable = false, unique = true, length = 64)
    private String cognitoSub;

    @Column(name = "display_name", nullable = false, length = 120)
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private Role role;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private UserStatus status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public AppUser(String username, String cognitoSub, String displayName, Role role) {
        this.id = UUID.randomUUID();
        this.username = username;
        this.cognitoSub = cognitoSub;
        this.displayName = displayName;
        this.role = role;
        this.status = UserStatus.ACTIVE;
    }

    public boolean isActive() {
        return status == UserStatus.ACTIVE;
    }

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
