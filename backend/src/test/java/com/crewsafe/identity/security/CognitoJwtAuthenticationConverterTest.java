package com.crewsafe.identity.security;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.UserStatus;
import com.crewsafe.identity.repository.AppUserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The audit-failure path in {@link CognitoJwtAuthenticationConverter}.
 *
 * <p>Unit rather than integration: the behaviour under test is what happens when the audit
 * <em>insert</em> fails while the rest of the request succeeds, and there is no honest way
 * to provoke that against a real database without breaking the same connection the
 * authentication lookup needs.
 *
 * <p>{@link CognitoTokenValidationTest} covers the happy path against real Cognito tokens.
 *
 * @author Jemilin Beulah
 */
class CognitoJwtAuthenticationConverterTest {

    private static final String SUB = "11111111-2222-3333-4444-555555555555";

    private AppUserRepository users;
    private AuditService audit;
    private CognitoJwtAuthenticationConverter converter;
    private AppUser user;

    @BeforeEach
    void setUp() {
        users = mock(AppUserRepository.class);
        audit = mock(AuditService.class);
        converter = new CognitoJwtAuthenticationConverter(users, audit);

        user = new AppUser("worker1", SUB, "Meng Hui (Worker)", Role.WORKER);
        when(users.findByCognitoSub(SUB)).thenReturn(Optional.of(user));
    }

    /** A token with a distinct {@code jti}, shaped like a Cognito access token. */
    private static Jwt tokenWithJti(String jti) {
        return Jwt.withTokenValue("token-" + jti)
                .header("alg", "RS256")
                .subject(SUB)
                .claim("jti", jti)
                .claim("token_use", "access")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(900))
                .build();
    }

    @Test
    void recordsTheFirstRequestWithAToken() {
        converter.convert(tokenWithJti("jti-1"));

        verify(audit).recordEvent(eq(user.getId()), eq(AuditEventType.TOKEN_FIRST_SEEN),
                eq("USER"), eq(user.getId()), any());
    }

    @Test
    void doesNotRecordTheSameTokenTwice() {
        Jwt token = tokenWithJti("jti-2");

        converter.convert(token);
        converter.convert(token);
        converter.convert(token);

        verify(audit, times(1)).recordEvent(eq(user.getId()), eq(AuditEventType.TOKEN_FIRST_SEEN),
                eq("USER"), eq(user.getId()), any());
    }

    /**
     * The reason this class exists. An audit-write failure must not surface as a 500 from an
     * authentication filter that can only translate {@code AuthenticationException} into a
     * clean 401, so the write fails open.
     */
    @Test
    void authenticationStillSucceedsWhenTheAuditWriteFails() {
        doThrow(new DataAccessResourceFailureException("audit table unavailable"))
                .when(audit).recordEvent(any(), any(), any(), any(), any());

        var authentication = converter.convert(tokenWithJti("jti-3"));

        assertThat(authentication).isNotNull();
        assertThat(authentication.getPrincipal())
                .isInstanceOf(CrewSafeUserPrincipal.class)
                .extracting(principal -> ((CrewSafeUserPrincipal) principal).getUsername())
                .isEqualTo("worker1");
    }

    /**
     * Failing open must not also mean failing silently and permanently. Marking the token as
     * audited before the write would leave the record lost for good: the next request would
     * short-circuit on the dedup guard and never retry it.
     */
    @Test
    void aFailedAuditWriteIsRetriedOnTheNextRequestWithTheSameToken() {
        Jwt token = tokenWithJti("jti-4");

        doThrow(new DataAccessResourceFailureException("audit table unavailable"))
                .when(audit).recordEvent(any(), any(), any(), any(), any());
        converter.convert(token);

        // The audit table recovers; the very same token is presented again.
        doNothing().when(audit).recordEvent(any(), any(), any(), any(), any());
        converter.convert(token);

        verify(audit, times(2)).recordEvent(eq(user.getId()), eq(AuditEventType.TOKEN_FIRST_SEEN),
                eq("USER"), eq(user.getId()), any());

        // ...and once it has succeeded, dedup resumes: no third write.
        converter.convert(token);
        verify(audit, times(2)).recordEvent(eq(user.getId()), eq(AuditEventType.TOKEN_FIRST_SEEN),
                eq("USER"), eq(user.getId()), any());
    }

    @Test
    void aTokenWithNoJtiIsNotAudited() {
        Jwt noJti = Jwt.withTokenValue("token-no-jti")
                .header("alg", "RS256")
                .subject(SUB)
                .claim("token_use", "access")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(900))
                .build();

        assertThat(converter.convert(noJti)).isNotNull();
        verify(audit, times(0)).recordEvent(any(), any(), any(), any(), any());
    }

    @Test
    void anUnknownSubIsRejected() {
        when(users.findByCognitoSub(SUB)).thenReturn(Optional.empty());
        Jwt token = tokenWithJti("jti-5");

        assertThatThrownBy(() -> converter.convert(token))
                .isInstanceOf(OAuth2AuthenticationException.class);
    }

    @Test
    void aDeactivatedUserIsRejectedAndNotAudited() {
        user.setStatus(UserStatus.INACTIVE);
        Jwt token = tokenWithJti("jti-6");

        assertThatThrownBy(() -> converter.convert(token))
                .isInstanceOf(OAuth2AuthenticationException.class);
        verify(audit, times(0)).recordEvent(any(), any(), any(), any(), any());
    }
}
