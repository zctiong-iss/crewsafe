package com.crewsafe.identity.security;

import com.crewsafe.identity.domain.AppUser;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;

/**
 * Issues and validates JWTs.
 *
 * <p>Algorithm is pinned to HS256. JJWT 0.12+ rejects {@code alg:none} by default, and
 * because we only ever verify with {@link #signingKey}, an attacker cannot talk us into
 * accepting a different algorithm.
 *
 * <p>Claims: {@code sub} (the user's UUID), {@code typ} (access or refresh), {@code jti},
 * {@code iss}, {@code iat}, {@code exp}.
 *
 * <p><strong>Roles are deliberately not in the token.</strong> They are re-read from the
 * database on every request, so a role change or a deactivated account takes effect
 * immediately instead of lingering until the token expires. The token carries identity,
 * not authority.
 *
 * <p>No PII — no username, email or display name — is placed in the payload. A JWT is
 * signed, not encrypted; anyone holding it can read every claim.
 */
@Service
@Slf4j
public class JwtService {

    private static final String CLAIM_TOKEN_TYPE = "typ";

    private final JwtProperties properties;
    private final SecretKey signingKey;

    public JwtService(JwtProperties properties) {
        this.properties = properties;
        // Built once at startup. Keys.hmacShaKeyFor throws WeakKeyException for a secret
        // under 256 bits, so a too-short JWT_SECRET fails the application start rather
        // than the first login attempt.
        this.signingKey = Keys.hmacShaKeyFor(properties.getSecret().getBytes(StandardCharsets.UTF_8));
    }

    public String generateAccessToken(AppUser user) {
        return generate(user.getId(), TokenType.ACCESS, properties.getAccessTokenTtl().toMillis());
    }

    public String generateRefreshToken(AppUser user) {
        return generate(user.getId(), TokenType.REFRESH, properties.getRefreshTokenTtl().toMillis());
    }

    /**
     * Extract the user id from an access token.
     *
     * @return the user id, or empty if the token is malformed, expired, signed with the
     *         wrong key, or is a refresh token being passed off as an access token
     */
    public Optional<UUID> extractUserId(String token, TokenType expectedType) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(signingKey)
                    .requireIssuer(properties.getIssuer())
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();

            String actualType = claims.get(CLAIM_TOKEN_TYPE, String.class);
            if (!expectedType.claimValue().equals(actualType)) {
                // The single most important check in this class. Both token types are
                // signed with the same key, so only this claim stops a long-lived refresh
                // token being replayed as an access token.
                log.debug("Rejected token: expected typ={} but found typ={}",
                        expectedType.claimValue(), actualType);
                return Optional.empty();
            }

            return Optional.of(UUID.fromString(claims.getSubject()));

        } catch (JwtException | IllegalArgumentException e) {
            // Never rethrow: callers return a uniform 401 and must not leak whether the
            // failure was a bad signature, an expired token or a malformed one.
            log.debug("Rejected token: {}", e.getClass().getSimpleName());
            return Optional.empty();
        }
    }

    public Duration accessTokenTtl() {
        return properties.getAccessTokenTtl();
    }

    private String generate(UUID userId, TokenType type, long ttlMillis) {
        Instant now = Instant.now();

        return Jwts.builder()
                .subject(userId.toString())
                .claim(CLAIM_TOKEN_TYPE, type.claimValue())
                .id(UUID.randomUUID().toString())
                .issuer(properties.getIssuer())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusMillis(ttlMillis)))
                .signWith(signingKey, Jwts.SIG.HS256)
                .compact();
    }
}
