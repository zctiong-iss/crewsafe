package com.crewsafe.common.security;

import com.crewsafe.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Security headers and the OpenAPI contract.
 *
 * Login rate limiting no longer applies here - there is no login endpoint on this backend
 * to flood. Cognito's Hosted UI is responsible for throttling sign-in attempts.
 *
 * @author Jemilin Beulah
 */
@AutoConfigureMockMvc
class HardeningTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;

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
                .andExpect(jsonPath("$.paths['/api/v1/me']").exists());
    }

    @Test
    void openApiSpecIsServedWithoutSettingACookie() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(header().doesNotExist("Set-Cookie"));
    }
}
