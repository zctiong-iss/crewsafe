package com.crewsafe.common.security;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.api.AuthDtos;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Rate limiting, security headers and the OpenAPI contract.
 *
 * Sets a deliberately tiny login budget so the limit can be reached in a few requests;
 * the rest of the suite runs with a large one (see AbstractIntegrationTest).
 */
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "app.rate-limit.login.capacity=3",
        "app.rate-limit.login.window=1m"
})
class HardeningTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    private String loginBody() throws Exception {
        return objectMapper.writeValueAsString(
                new AuthDtos.LoginRequest("nobody-" + UUID.randomUUID(), "whatever"));
    }

    @Test
    void loginIsRateLimitedAfterTheConfiguredNumberOfAttempts() throws Exception {
        // Budget is 3. The first three fail authentication (401); the fourth never gets
        // that far because the rate limit filter runs before authentication.
        for (int i = 0; i < 3; i++) {
            mockMvc.perform(post("/api/v1/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(loginBody()))
                    .andExpect(status().isUnauthorized());
        }

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody()))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("Too Many Requests"));
    }

    @Test
    void rateLimitDoesNotApplyToOtherEndpoints() throws Exception {
        // Only POST /auth/login is limited; a shared limit would let a login flood take
        // down the whole API.
        for (int i = 0; i < 10; i++) {
            mockMvc.perform(get("/actuator/health")).andExpect(status().isOk());
        }
    }

    @Test
    void securityHeadersArePresent() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(header().string("Content-Security-Policy",
                        "default-src 'self'; frame-ancestors 'none'; object-src 'none'"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("X-Frame-Options", "DENY"))
                .andExpect(header().string("Referrer-Policy", "no-referrer"));
    }

    @Test
    void openApiSpecIsAvailableAndDescribesBearerAuth() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.info.title").value("WBGT CrewSafe SG API"))
                .andExpect(jsonPath("$.components.securitySchemes.bearerAuth.scheme").value("bearer"))
                .andExpect(jsonPath("$.paths['/api/v1/auth/login']").exists())
                .andExpect(jsonPath("$.paths['/api/v1/me']").exists());
    }

    @Test
    void openApiSpecIsServedWithoutSettingACookie() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(header().doesNotExist("Set-Cookie"));
    }
}
