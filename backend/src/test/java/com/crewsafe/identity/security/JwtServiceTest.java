package com.crewsafe.identity.security;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Plain unit tests - no Spring context, no database.
 */
class JwtServiceTest {

    private static final String SECRET = "unit-test-signing-secret-at-least-32-bytes";

    private JwtService jwtService;
    private AppUser user;

    private static JwtProperties propertiesWith(String secret, Duration accessTtl, Duration refreshTtl) {
        JwtProperties p = new JwtProperties();
        p.setSecret(secret);
        p.setAccessTokenTtl(accessTtl);
        p.setRefreshTokenTtl(refreshTtl);
        p.setIssuer("crewsafe");
        return p;
    }

    @BeforeEach
    void setUp() {
        jwtService = new JwtService(propertiesWith(SECRET, Duration.ofMinutes(15), Duration.ofDays(7)));
        user = new AppUser("worker1", "$2a$10$hash", "Test Worker", Role.WORKER);
    }

    // --- happy path ---

    @Test
    void accessTokenRoundTripsTheUserId() {
        String token = jwtService.generateAccessToken(user);

        assertThat(jwtService.extractUserId(token, TokenType.ACCESS)).contains(user.getId());
    }

    @Test
    void refreshTokenRoundTripsTheUserId() {
        String token = jwtService.generateRefreshToken(user);

        assertThat(jwtService.extractUserId(token, TokenType.REFRESH)).contains(user.getId());
    }

    // --- the critical separation between token types ---

    @Test
    void refreshTokenIsRejectedWhenPresentedAsAnAccessToken() {
        String refreshToken = jwtService.generateRefreshToken(user);

        // Both tokens are signed with the same key. Without the typ claim check this
        // would succeed, and a 7-day refresh token would work as a 7-day API key.
        assertThat(jwtService.extractUserId(refreshToken, TokenType.ACCESS)).isEmpty();
    }

    @Test
    void accessTokenIsRejectedWhenPresentedAsARefreshToken() {
        String accessToken = jwtService.generateAccessToken(user);

        assertThat(jwtService.extractUserId(accessToken, TokenType.REFRESH)).isEmpty();
    }

    // --- tampering and expiry ---

    @Test
    void tokenSignedWithADifferentKeyIsRejected() {
        JwtService attacker = new JwtService(
                propertiesWith("a-completely-different-secret-key-32-bytes", Duration.ofMinutes(15), Duration.ofDays(7)));
        String forged = attacker.generateAccessToken(user);

        assertThat(jwtService.extractUserId(forged, TokenType.ACCESS)).isEmpty();
    }

    @Test
    void expiredTokenIsRejected() {
        JwtService shortLived = new JwtService(
                propertiesWith(SECRET, Duration.ofSeconds(-1), Duration.ofDays(7)));
        String alreadyExpired = shortLived.generateAccessToken(user);

        assertThat(jwtService.extractUserId(alreadyExpired, TokenType.ACCESS)).isEmpty();
    }

    @Test
    void tokenFromAnotherIssuerIsRejected() {
        JwtService otherIssuer = new JwtService(withIssuer(SECRET, "some-other-service"));
        String token = otherIssuer.generateAccessToken(user);

        assertThat(jwtService.extractUserId(token, TokenType.ACCESS)).isEmpty();
    }

    @Test
    void unsignedTokenIsRejected() {
        // alg:none - the classic JWT attack. JJWT 0.12+ refuses these by default.
        String unsigned = Jwts.builder()
                .subject(user.getId().toString())
                .claim("typ", "access")
                .issuer("crewsafe")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .compact();

        assertThat(jwtService.extractUserId(unsigned, TokenType.ACCESS)).isEmpty();
    }

    @Test
    void tokenWithoutATypeClaimIsRejected() {
        String noType = Jwts.builder()
                .subject(user.getId().toString())
                .issuer("crewsafe")
                .expiration(Date.from(Instant.now().plusSeconds(3600)))
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)), Jwts.SIG.HS256)
                .compact();

        assertThat(jwtService.extractUserId(noType, TokenType.ACCESS)).isEmpty();
    }

    @Test
    void malformedAndEmptyTokensAreRejectedWithoutThrowing() {
        for (String bad : new String[]{"", "   ", "not-a-jwt", "a.b.c", "Bearer x"}) {
            Optional<UUID> result = jwtService.extractUserId(bad, TokenType.ACCESS);
            assertThat(result).as("token %s", bad).isEmpty();
        }
    }

    // --- configuration safety ---

    @Test
    void secretShorterThan256BitsIsRejectedAtConstruction() {
        // Fails at application startup rather than at the first login.
        assertThatThrownBy(() -> new JwtService(propertiesWith("too-short", Duration.ofMinutes(15), Duration.ofDays(7))))
                .isInstanceOf(io.jsonwebtoken.security.WeakKeyException.class);
    }

    @Test
    void accessAndRefreshTokensForTheSameUserAreDistinct() {
        assertThat(jwtService.generateAccessToken(user))
                .isNotEqualTo(jwtService.generateRefreshToken(user));
    }

    private static JwtProperties withIssuer(String secret, String issuer) {
        JwtProperties p = propertiesWith(secret, Duration.ofMinutes(15), Duration.ofDays(7));
        p.setIssuer(issuer);
        return p;
    }
}
