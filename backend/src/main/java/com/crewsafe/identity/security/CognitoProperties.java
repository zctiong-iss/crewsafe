package com.crewsafe.identity.security;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.util.List;

/**
 * Binds {@code app.cognito.*}.
 *
 * {@code issuerUri} and {@code jwkSetUri} are configured separately rather than relying on
 * Spring's OIDC-discovery-from-issuer shortcut. Real Cognito would let discovery work, but
 * cognito-local's discovery document advertises whatever host and port it happens to be
 * reached on - which, under Testcontainers, is a different port every run. Keeping the two
 * properties independent means the issuer used for token validation can stay a fixed,
 * logical value while the JWKS location tracks wherever the emulator actually is.
 *
 * @author Jemilin Beulah
 */
@ConfigurationProperties(prefix = "app.cognito")
@Validated
@Getter
@Setter
public class CognitoProperties {

    /** Must match the {@code iss} claim on every token exactly. */
    @NotBlank
    private String issuerUri;

    /** Where the signing keys are actually fetched from. */
    @NotBlank
    private String jwkSetUri;

    /** The app client ids this API accepts tokens from - our web and mobile clients. */
    @NotEmpty
    private List<String> clientIds;

    /** Used only by {@code DemoDataSeeder} to look up demo users' {@code sub} at startup. */
    @NotBlank
    private String userPoolId;

    /** Used only by {@code DemoDataSeeder}. Any valid AWS region name - cognito-local
     *  does not check it, but the SDK client requires one to be set. */
    @NotBlank
    private String region;

    /**
     * Points the Cognito SDK client at cognito-local instead of real AWS. Blank outside
     * local development, where the SDK talks to the real regional endpoint. Not
     * {@code @NotBlank}: blank is the normal, correct value everywhere but local.
     */
    private String endpointOverride;
}
