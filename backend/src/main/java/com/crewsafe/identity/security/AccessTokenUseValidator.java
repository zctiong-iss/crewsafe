package com.crewsafe.identity.security;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Requires {@code token_use == "access"}.
 *
 * Cognito issues an ID token and an access token, both signed by the same keys. Accepting
 * either interchangeably would let a client send us an ID token - which carries no scope
 * and was never meant to authorize an API call - as if it were an access token.
 *
 * @author Jemilin Beulah
 */
class AccessTokenUseValidator implements OAuth2TokenValidator<Jwt> {

    private static final OAuth2Error INVALID_TOKEN_USE =
            new OAuth2Error("invalid_token", "token_use must be access", null);

    @Override
    public OAuth2TokenValidatorResult validate(Jwt token) {
        if ("access".equals(token.getClaimAsString("token_use"))) {
            return OAuth2TokenValidatorResult.success();
        }
        return OAuth2TokenValidatorResult.failure(INVALID_TOKEN_USE);
    }
}
