package com.crewsafe.identity.security;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/**
 * Binds {@code app.jwt.*}.
 *
 * The secret is sourced from the JWT_SECRET environment variable and is never hardcoded.
 * {@code @NotBlank} means the application refuses to start without it rather than issuing
 * tokens signed with an empty key.
 */
@ConfigurationProperties(prefix = "app.jwt")
@Validated
@Getter
@Setter
public class JwtProperties {

    /** HS256 signing secret. Must be at least 256 bits (32 characters). */
    @NotBlank
    private String secret;

    /** How long an access token stays valid. Short by design. */
    private Duration accessTokenTtl = Duration.ofMinutes(15);

    /** How long a refresh token stays valid. */
    private Duration refreshTokenTtl = Duration.ofDays(7);

    /** Recorded as the {@code iss} claim. */
    private String issuer = "crewsafe";
}
