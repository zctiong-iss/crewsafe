package com.crewsafe.identity.security;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.Set;

/**
 * Requires {@code client_id} to be one of our own app clients.
 *
 * Cognito access tokens carry no {@code aud} claim - {@code client_id} is the only signal
 * that a token was issued to one of our clients rather than some other app client in the
 * same user pool. Spring's default audience validator does nothing here, so without this
 * check a token from an unrelated client would be accepted.
 */
class AllowedClientIdValidator implements OAuth2TokenValidator<Jwt> {

    private static final OAuth2Error UNKNOWN_CLIENT =
            new OAuth2Error("invalid_token", "client_id is not recognised", null);

    private final Set<String> allowedClientIds;

    AllowedClientIdValidator(Set<String> allowedClientIds) {
        this.allowedClientIds = allowedClientIds;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt token) {
        // An ID token has no client_id claim at all (it carries aud instead), so the claim
        // may legitimately be absent - it is exactly the kind of token this check exists to
        // reject. The null guard below is load-bearing for a second reason: allowedClientIds
        // is an immutable Set, and Set.copyOf(...).contains(null) throws NullPointerException
        // rather than returning false. Absent claim + immutable set is the trap.
        String clientId = token.getClaimAsString("client_id");
        if (clientId != null && allowedClientIds.contains(clientId)) {
            return OAuth2TokenValidatorResult.success();
        }
        return OAuth2TokenValidatorResult.failure(UNKNOWN_CLIENT);
    }
}
