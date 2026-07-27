package com.crewsafe.common.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * OpenAPI 3 description of the API.
 *
 * The generated spec is the contract the React and React Native clients generate their
 * typed HTTP clients from, so it is a build artifact rather than documentation for its
 * own sake.
 */
@Configuration
public class OpenApiConfig {

    private static final String BEARER_SCHEME = "bearerAuth";

    @Bean
    public OpenAPI crewSafeOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("WBGT CrewSafe SG API")
                        .version("v1")
                        .description("""
                                Shared backend for WBGT CrewSafe SG.

                                Authentication is a JWT bearer token obtained from
                                POST /api/v1/auth/login. No cookies are used anywhere in
                                this API - send the token in the Authorization header."""))
                .components(new Components().addSecuritySchemes(BEARER_SCHEME,
                        new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")))
                // Applied globally: the handful of public endpoints are the exception,
                // so documenting auth as the default matches how the API behaves.
                .addSecurityItem(new SecurityRequirement().addList(BEARER_SCHEME));
    }
}
