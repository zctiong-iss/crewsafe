package com.crewsafe.identity.security;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.UserStatus;
import com.crewsafe.identity.repository.AppUserRepository;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Date;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The validation traps in {@code CognitoJwtAuthenticationConverter} and
 * {@code SecurityConfig.cognitoJwtDecoder} - the only authentication surface left once
 * login moves entirely into Cognito's Hosted UI.
 *
 * Tokens here are minted for real against cognito-local (see AbstractIntegrationTest), the
 * same emulator used by local development, so these exercise the genuine JWKS lookup and
 * signature check rather than a stub.
 *
 * @author Jemilin Beulah
 */
@AutoConfigureMockMvc
class CognitoTokenValidationTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;

    private AppUser registerUser(Role role) {
        String username = "tokentest-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), "Token Test", role));
    }

    @Test
    void validAccessTokenAuthenticatesTheMeEndpoint() throws Exception {
        AppUser user = registerUser(Role.WORKER);
        String token = mintAccessToken(user.getUsername());

        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(user.getUsername()))
                .andExpect(jsonPath("$.role").value("WORKER"));
    }

    @Test
    void meResponseNeverLeaksTheCognitoSub() throws Exception {
        AppUser user = registerUser(Role.WORKER);
        String token = mintAccessToken(user.getUsername());

        String body = mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain(user.getCognitoSub());
    }

    /**
     * The single most important test in this class. ID and access tokens are signed with
     * the same keys, so only the {@code token_use} claim stops one being replayed as the
     * other.
     */
    @Test
    void idTokenIsRejectedAsAnAccessToken() throws Exception {
        AppUser user = registerUser(Role.WORKER);
        String idToken = mintIdToken(user.getUsername());

        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + idToken))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void tokenFromAnUnrecognisedClientIsRejected() throws Exception {
        AppUser user = registerUser(Role.WORKER);
        String otherClientId = createUntrustedAppClient("some-other-app");
        String token = mintAccessToken(otherClientId, user.getUsername());

        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void tokenForASubWithNoMatchingAccountIsRejected() throws Exception {
        // Validly signed by Cognito, but no app_user row was ever created for this sub -
        // accounts are administered (FR-01), not provisioned just-in-time.
        String username = "tokentest-orphan-" + UUID.randomUUID();
        createCognitoUser(username);
        String token = mintAccessToken(username);

        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void deactivatedUserCannotUseAnExistingToken() throws Exception {
        AppUser user = registerUser(Role.WORKER);
        String token = mintAccessToken(user.getUsername());

        user.setStatus(UserStatus.INACTIVE);
        users.save(user);

        // The token is still cryptographically valid. Account status is re-read from the
        // database on every request, so deactivation takes effect immediately rather than
        // whenever the token happens to expire.
        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    /**
     * A token from a different user pool: correct {@code token_use}, a {@code client_id} we
     * trust, a signature that verifies against our JWKS (cognito-local signs every pool with
     * one hardcoded keypair), and a local {@code app_user} row for its {@code sub}. Every
     * other check passes, so only the issuer check can reject it.
     *
     * <p>This matters because {@code issuer-uri} and {@code jwk-set-uri} are configured as
     * two independent properties (see {@code CognitoProperties}). Nothing else in this suite
     * fails if the issuer validator is removed or its property drifts.
     */
    @Test
    void tokenFromAnotherUserPoolIsRejectedByTheIssuerCheck() throws Exception {
        String username = "otherpool-" + UUID.randomUUID();
        createCognitoUser(OTHER_POOL_ID, username);
        users.save(new AppUser(username, subFor(OTHER_POOL_ID, username), "Other Pool", Role.WORKER));

        String token = mintAccessToken(OTHER_POOL_CLIENT_ID, username);

        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void tokenSignedByAnUntrustedKeyIsRejected() throws Exception {
        // Same claim shape a real cognito-local token would have, including the correct
        // issuer, but signed by a key that never appears in our configured JWKS. This is the
        // signature check alone - the wrong-issuer case is covered separately above.
        var forgedKey = new RSAKeyGenerator(2048).keyID("forged").generate();
        Instant now = Instant.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .subject(UUID.randomUUID().toString())
                .issuer(ISSUER_URI)
                .claim("token_use", "access")
                .claim("client_id", CLIENT_ID)
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plusSeconds(3600)))
                .build();

        SignedJWT forged = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("forged").build(),
                claims);
        forged.sign(new RSASSASigner(forgedKey));

        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + forged.serialize()))
                .andExpect(status().isUnauthorized());
    }
}
