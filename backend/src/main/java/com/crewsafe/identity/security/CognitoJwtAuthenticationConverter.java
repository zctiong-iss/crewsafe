package com.crewsafe.identity.security;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.repository.AppUserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Bridges a Cognito-validated access token to our own authenticated principal.
 *
 * By the time this runs, signature, expiry, issuer, {@code token_use} and {@code client_id}
 * have all already passed (see the validators wired into {@code cognitoJwtDecoder} in
 * {@link SecurityConfig}). All that is left is resolving the token's {@code sub} to a local
 * account.
 *
 * <p>Accounts are administered, not self-service (FR-01): a validly-signed token for a
 * {@code sub} with no matching {@code app_user} row, or a deactivated one, is rejected here
 * rather than provisioned on the fly. Role and status are read from the database on every
 * request, so a demotion or deactivation takes effect on the very next call rather than
 * whenever the token happens to expire.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class CognitoJwtAuthenticationConverter implements Converter<Jwt, AbstractAuthenticationToken> {

    /**
     * An unbounded cache keyed by token-controlled input is a memory-exhaustion vector, so
     * this one is bounded. Clearing it when full briefly re-audits a few live tokens, which
     * is harmless - the cost of the alternative is exhausting the heap.
     */
    private static final int MAX_TRACKED_TOKENS = 10_000;

    private final AppUserRepository users;
    private final AuditService audit;
    private final Set<String> auditedTokens = ConcurrentHashMap.newKeySet();

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        AppUser user = users.findByCognitoSub(jwt.getSubject())
                .filter(AppUser::isActive)
                .orElseThrow(() -> unknownUser(jwt));

        auditFirstRequestWithThisToken(jwt, user);

        CrewSafeUserPrincipal principal = new CrewSafeUserPrincipal(user);
        return new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
    }

    /**
     * Login itself happens entirely inside Cognito's Hosted UI, off our infrastructure, so
     * the backend never sees a login attempt to audit directly (FR-04). What it can see is
     * the first API call made with a given token - not a perfect substitute (a user who
     * authenticates and never calls the API leaves no trace either way), but the closest
     * honest signal available from a pure resource server, using a class that already
     * exists for this purpose rather than standing up a Lambda trigger for it.
     */
    private void auditFirstRequestWithThisToken(Jwt jwt, AppUser user) {
        String jti = jwt.getId();
        if (jti == null) {
            return;
        }
        if (auditedTokens.size() >= MAX_TRACKED_TOKENS) {
            auditedTokens.clear();
        }
        if (!auditedTokens.add(jti)) {
            return;
        }

        // This runs on the first request of every token, so an audit-write failure here
        // would otherwise escape as a 500 from an authentication filter that only knows how
        // to turn AuthenticationExceptions into a 401. This record is observability, not an
        // authorization decision - losing one is worse than nothing but far better than
        // taking the whole API down - so the failure is logged loudly and swallowed.
        // SiteAccessEvaluator's ACCESS_DENIED record is a security decision and is
        // deliberately not treated this way.
        try {
            audit.record(user.getId(), AuditEventType.TOKEN_FIRST_SEEN,
                    "First authenticated request seen for this access token");
        } catch (RuntimeException e) {
            log.error("Failed to write {} audit event for user={}",
                    AuditEventType.TOKEN_FIRST_SEEN, user.getId(), e);
        }
    }

    /**
     * Logged because it is both a genuine security signal (a validly-signed Cognito token
     * with no local account behind it) and the likeliest support question a new starter
     * generates. No audit row is written: there is no {@code app_user} to attribute it to,
     * and a row per request would let a single rejected token flood the table.
     */
    private static OAuth2AuthenticationException unknownUser(Jwt jwt) {
        log.warn("Rejected token for unknown or inactive user: sub={}", jwt.getSubject());
        return new OAuth2AuthenticationException(
                new OAuth2Error(OAuth2ErrorCodes.INVALID_TOKEN, "Unknown or inactive user", null));
    }
}
