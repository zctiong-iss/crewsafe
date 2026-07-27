package com.crewsafe.identity.security;

/**
 * Distinguishes an access token from a refresh token.
 *
 * Both are signed with the same key, so without this distinction a refresh token would be
 * accepted anywhere an access token is — turning a 7-day credential into a 7-day API key.
 * The value is carried in the {@code typ} claim and checked on every parse.
 */
public enum TokenType {

    ACCESS("access"),
    REFRESH("refresh");

    private final String claimValue;

    TokenType(String claimValue) {
        this.claimValue = claimValue;
    }

    public String claimValue() {
        return claimValue;
    }
}
