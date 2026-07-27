package com.crewsafe.identity.api;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.identity.api.AuthDtos.LoginRequest;
import com.crewsafe.identity.api.AuthDtos.RefreshRequest;
import com.crewsafe.identity.api.AuthDtos.TokenResponse;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.identity.security.JwtService;
import com.crewsafe.identity.security.TokenType;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Issues and renews tokens.
 *
 * Both endpoints are {@code permitAll} — they are how a caller obtains credentials in the
 * first place — so they validate their own input carefully and reveal nothing on failure.
 */
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
@Slf4j
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final AppUserRepository users;
    private final JwtService jwtService;
    private final AuditService audit;

    @PostMapping("/login")
    public ResponseEntity<TokenResponse> login(@Valid @RequestBody LoginRequest request) {
        Authentication authentication;
        try {
            authentication = authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(request.username(), request.password()));
        } catch (AuthenticationException e) {
            // Recorded for brute-force detection. The attempted username is kept here, in
            // the internal audit trail — never echoed back to the caller.
            audit.record(null, AuditEventType.LOGIN_FAILURE,
                    "Failed login for username=" + request.username());
            throw e;
        }

        CrewSafeUserPrincipal principal = (CrewSafeUserPrincipal) authentication.getPrincipal();
        AppUser user = users.findById(principal.getId()).orElseThrow();

        audit.record(user.getId(), AuditEventType.LOGIN_SUCCESS, null, user.getId(), null);

        return ResponseEntity.ok(tokensFor(user));
    }

    /**
     * Exchanges a refresh token for a new pair.
     *
     * Note what this cannot do: refresh tokens are stateless, so the previous one stays
     * valid until it expires. Rotation here limits how long a leaked token remains useful
     * in practice, but it is not revocation. Recorded as an accepted limitation.
     */
    @PostMapping("/refresh")
    public ResponseEntity<TokenResponse> refresh(@Valid @RequestBody RefreshRequest request) {
        Optional<UUID> userId = jwtService.extractUserId(request.refreshToken(), TokenType.REFRESH);
        if (userId.isEmpty()) {
            return unauthorized();
        }

        Optional<AppUser> user = users.findById(userId.get());
        if (user.isEmpty() || !user.get().isActive()) {
            return unauthorized();
        }

        audit.record(user.get().getId(), AuditEventType.TOKEN_REFRESHED, null, user.get().getId(), null);

        return ResponseEntity.ok(tokensFor(user.get()));
    }

    private TokenResponse tokensFor(AppUser user) {
        return TokenResponse.of(
                jwtService.generateAccessToken(user),
                jwtService.generateRefreshToken(user),
                jwtService.accessTokenTtl().toSeconds());
    }

    private ResponseEntity<TokenResponse> unauthorized() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }

    /**
     * Every authentication failure returns the same 401 body regardless of cause.
     *
     * Distinguishing "no such user" from "wrong password" hands an attacker a free
     * username oracle — they can enumerate valid accounts without ever guessing a password.
     */
    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<Map<String, String>> handleAuthenticationFailure(AuthenticationException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Unauthorized", "message", "Authentication failed"));
    }
}
