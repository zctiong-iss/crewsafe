package com.crewsafe.admin.cognito;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;

/**
 * Region is hardcoded, not configurable: {@code infra/terraform/cognito/variables.tf}
 * hard-validates this project's one Cognito pool can never be anywhere but
 * ap-southeast-1, so a configurable field would be complexity with no real second value it
 * could ever hold (contrast {@code BedrockClientConfiguration}, whose region genuinely could
 * change per-model).
 *
 * <p>Building the client needs no credentials or network call — both are resolved lazily,
 * per-call, from the task role's credentials. Safe to always construct regardless of whether
 * {@link CognitoAdminProperties#getUserPoolId()} is configured; only an actual API call can
 * fail.
 *
 * @author Jemilin Beulah
 */
@Configuration
@EnableConfigurationProperties(CognitoAdminProperties.class)
public class CognitoAdminClientConfiguration {

    @Bean
    public CognitoIdentityProviderClient cognitoIdentityProviderClient() {
        return CognitoIdentityProviderClient.builder()
                .region(Region.AP_SOUTHEAST_1)
                .build();
    }
}
