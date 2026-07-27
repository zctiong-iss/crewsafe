package com.crewsafe.identity.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

/**
 * Request and response shapes for the authentication endpoints.
 *
 * Records, so they are immutable and cannot accidentally carry state between requests.
 */
public final class AuthDtos {

    private AuthDtos() {
    }

    public record LoginRequest(
            @NotBlank @Size(max = 64) String username,
            @NotBlank @Size(max = 200) String password) {
    }

    public record RefreshRequest(
            @NotBlank String refreshToken) {
    }

    /**
     * {@code expiresInSeconds} describes the access token only, so a client knows when to
     * refresh without having to parse the JWT itself.
     */
    public record TokenResponse(
            String accessToken,
            String refreshToken,
            String tokenType,
            long expiresInSeconds) {

        public static TokenResponse of(String accessToken, String refreshToken, long expiresInSeconds) {
            return new TokenResponse(accessToken, refreshToken, "Bearer", expiresInSeconds);
        }
    }

    /**
     * The current user. Carries no password hash and no audit fields — a response DTO
     * exists precisely so that entity fields are never exposed by accident.
     */
    public record MeResponse(
            UUID id,
            String username,
            String displayName,
            String role,
            List<UUID> siteIds) {
    }
}
