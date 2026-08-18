package com.crewsafe.identity.security;

import com.crewsafe.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Behaviour of the filter chain itself, independent of any particular endpoint.
 *
 * @author Jemilin Beulah
 */
@AutoConfigureMockMvc
class SecurityChainTest extends AbstractIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void protectedEndpointWithoutATokenReturns401Json() throws Exception {
        mockMvc.perform(get("/api/v1/anything"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Unauthorized"));
    }

    @Test
    void protectedEndpointWithAGarbageTokenReturns401() throws Exception {
        mockMvc.perform(get("/api/v1/anything").header("Authorization", "Bearer not-a-real-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Unauthorized"));
    }

    @Test
    void crossSiteRequestWithoutAuthenticationRemainsDenied() throws Exception {
        mockMvc.perform(get("/api/v1/me").header("Origin", "https://cross-site.example.invalid"))
                // Spring's CORS processor rejects the disallowed origin before the
                // authentication entry point runs; the important invariant is denial.
                .andExpect(status().isForbidden());
    }

    @Test
    void healthEndpointStaysPublic() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk());
    }

    @Test
    void livenessAndReadinessProbesArePublicWithoutRedirects() throws Exception {
        mockMvc.perform(get("/actuator/health/liveness"))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isIn(200, 503))
                .andExpect(header().doesNotExist("Location"))
                .andExpect(header().doesNotExist("Set-Cookie"));

        mockMvc.perform(get("/actuator/health/readiness"))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isIn(200, 503))
                .andExpect(header().doesNotExist("Location"))
                .andExpect(header().doesNotExist("Set-Cookie"));
    }

    @Test
    void noSessionCookieIsEverIssued() throws Exception {
        // The project claims to be cookie-free. Assert it rather than trusting it: a
        // stray JSESSIONID would mean a session is being created somewhere.
        mockMvc.perform(get("/actuator/health"))
                .andExpect(header().doesNotExist("Set-Cookie"));

        mockMvc.perform(get("/api/v1/anything"))
                .andExpect(header().doesNotExist("Set-Cookie"));
    }

    @Test
    void unauthenticatedRequestGetsNoLoginRedirect() throws Exception {
        // Form login is disabled, so failures must be 401 JSON and never a 302 to a
        // login page - which a JSON client cannot do anything useful with.
        mockMvc.perform(get("/api/v1/anything"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().doesNotExist("Location"));
    }
}
