package com.crewsafe.wellbeing.api;

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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Role and site boundaries for the read-only US-11 concern stream. */
@AutoConfigureMockMvc
class ConcernStreamAuthorizationTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void shortStreamTiming(DynamicPropertyRegistry registry) {
        registry.add("app.wellbeing.stream.push-interval", () -> "200ms");
        registry.add("app.wellbeing.stream.emitter-timeout", () -> "2s");
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;

    private Site siteA;
    private String workerAToken;
    private String supervisorAToken;
    private String supervisorBToken;
    private String managerAToken;
    private String adminToken;

    @BeforeEach
    void setUp() {
        siteA = site("Site A");
        Site siteB = site("Site B");

        AppUser workerA = user(Role.WORKER);
        AppUser supervisorA = user(Role.SUPERVISOR);
        AppUser supervisorB = user(Role.SUPERVISOR);
        AppUser managerA = user(Role.SAFETY_MANAGER);
        AppUser admin = user(Role.ADMIN);

        memberships.save(new SiteMembership(workerA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(supervisorA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(supervisorB.getId(), siteB.getId()));
        memberships.save(new SiteMembership(managerA.getId(), siteA.getId()));

        workerAToken = mintAccessToken(workerA.getUsername());
        supervisorAToken = mintAccessToken(supervisorA.getUsername());
        supervisorBToken = mintAccessToken(supervisorB.getUsername());
        managerAToken = mintAccessToken(managerA.getUsername());
        adminToken = mintAccessToken(admin.getUsername());
    }

    @Test
    void assignedSupervisorSafetyManagerAndAdminCanOpenTheStream() throws Exception {
        assertAllowed(supervisorAToken);
        assertAllowed(managerAToken);
        assertAllowed(adminToken);
    }

    @Test
    void workerIsForbiddenEvenAtTheirOwnSite() throws Exception {
        mockMvc.perform(get(streamUrl()).header("Authorization", "Bearer " + workerAToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void supervisorCannotOpenAnotherSitesStream() throws Exception {
        mockMvc.perform(get(streamUrl()).header("Authorization", "Bearer " + supervisorBToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void unauthenticatedRequestIsUnauthorized() throws Exception {
        mockMvc.perform(get(streamUrl())).andExpect(status().isUnauthorized());
    }

    private void assertAllowed(String token) throws Exception {
        mockMvc.perform(get(streamUrl()).header("Authorization", "Bearer " + token))
                .andExpect(request().asyncStarted())
                .andExpect(status().isOk());
    }

    private String streamUrl() {
        return "/api/v1/sites/" + siteA.getId() + "/concerns/stream";
    }

    private AppUser user(Role role) {
        String username = "concern-stream-authz-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), "Concern Stream " + role, role));
    }

    private Site site(String label) {
        return sites.save(new Site("Concern Stream " + label + " " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
    }
}
