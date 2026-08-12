package com.crewsafe.common.security;

import com.crewsafe.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Browser-origin allowlisting for API preflight requests.
 */
@AutoConfigureMockMvc
@TestPropertySource(properties = "app.cors.allowed-origins=https://d3b75ru76gta2n.cloudfront.net")
class CorsConfigurationTest extends AbstractIntegrationTest {

    private static final String DEPLOYED_WEB_ORIGIN = "https://d3b75ru76gta2n.cloudfront.net";

    @Autowired
    private MockMvc mockMvc;

    @Test
    void deployedWebOriginReceivesTheExactCorsGrant() throws Exception {
        mockMvc.perform(options("/api/v1/me")
                        .header("Origin", DEPLOYED_WEB_ORIGIN)
                        .header("Access-Control-Request-Method", "GET")
                        .header("Access-Control-Request-Headers", "Authorization"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", DEPLOYED_WEB_ORIGIN))
                .andExpect(header().string("Access-Control-Allow-Methods", containsString("GET")))
                .andExpect(header().string("Access-Control-Allow-Headers", "Authorization"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
    }

    @Test
    void unlistedOriginDoesNotReceiveACorsGrant() throws Exception {
        mockMvc.perform(options("/api/v1/me")
                        .header("Origin", "https://untrusted.example")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }
}
