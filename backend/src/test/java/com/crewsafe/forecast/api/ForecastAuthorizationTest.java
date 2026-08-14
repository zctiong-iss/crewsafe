package com.crewsafe.forecast.api;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Verifies that the forecast door follows the project's existing site-access rules. */
@AutoConfigureMockMvc
class ForecastAuthorizationTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;

    private Site siteA;
    private Site siteB;
    private String workerAToken;
    private String workerBToken;
    private String adminToken;

    @BeforeEach
    void setUp() {
        siteA = createSite("A");
        siteB = createSite("B");

        AppUser workerA = createUser(Role.WORKER);
        AppUser workerB = createUser(Role.WORKER);
        AppUser admin = createUser(Role.ADMIN);
        memberships.save(new SiteMembership(workerA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(workerB.getId(), siteB.getId()));

        workerAToken = mintAccessToken(workerA.getUsername());
        workerBToken = mintAccessToken(workerB.getUsername());
        adminToken = mintAccessToken(admin.getUsername());
    }

    @Test
    void assignedWorkerReachesTheForecastDoor() throws Exception {
        // No weather is seeded, so 503 proves authorization passed and the service ran.
        mockMvc.perform(get(forecastUrl()).header("Authorization", "Bearer " + workerAToken))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void adminReachesTheForecastDoorWithoutMembership() throws Exception {
        mockMvc.perform(get(forecastUrl()).header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void workerCannotReadAnotherSitesForecast() throws Exception {
        mockMvc.perform(get(forecastUrl()).header("Authorization", "Bearer " + workerBToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void unauthenticatedForecastRequestIsRejected() throws Exception {
        mockMvc.perform(get(forecastUrl()))
                .andExpect(status().isUnauthorized());
    }

    private AppUser createUser(Role role) {
        String username = "forecast-authz-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), "Forecast Authz " + role, role));
    }

    private Site createSite(String label) {
        return sites.save(new Site(
                "Forecast Authz " + label + " " + UUID.randomUUID(),
                new BigDecimal("1.300000"),
                new BigDecimal("103.800000")));
    }

    private String forecastUrl() {
        return "/api/v1/sites/" + siteA.getId() + "/weather/forecast";
    }

}
