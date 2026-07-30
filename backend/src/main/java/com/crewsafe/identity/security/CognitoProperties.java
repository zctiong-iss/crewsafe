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
 * {@code issuerUri} and {@code jwkSetUri} are configured separately so the deployed
 * boundary is explicit and the pinned Testcontainers fixture can still override the JWKS
 * location without weakening issuer validation.
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

    /** Synthetic, non-sensitive local application mappings keyed by immutable Cognito sub. */
    private String demoUsersJson;
}
