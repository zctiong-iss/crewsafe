package com.crewsafe.conditions.api;

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

/**
 * Authorization behaviour of the SSE conditions endpoint: reuses {@code @siteAccess} and the
 * same SUPERVISOR/SAFETY_MANAGER/ADMIN role gate as
 * {@link com.crewsafe.site.api.SiteController#getDashboard}, so it must be denied and allowed
 * in exactly the same shapes.
 *
 * @author Jemilin Beulah
 */
@AutoConfigureMockMvc
class SiteConditionsAuthorizationTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void shortStreamTiming(DynamicPropertyRegistry registry) {
        // Short-circuits the production 15s/5min defaults so a leftover emitter doesn't linger.
        registry.add("app.conditions.stream.push-interval", () -> "200ms");
        registry.add("app.conditions.stream.emitter-timeout", () -> "2s");
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;

    private Site siteA;
    private Site siteB;
    private String workerAToken;
    private String supervisorAToken;
    private String supervisorBToken;
    private String managerAToken;
    private String adminToken;

    private AppUser user(Role role) {
        String username = "conditions-authz-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), "Conditions Authz Test " + role, role));
    }

    private Site site(String label) {
        return sites.save(new Site("Conditions Authz " + label + " " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
    }

    @BeforeEach
    void setUp() {
        siteA = site("Site A");
        siteB = site("Site B");

        AppUser workerA = user(Role.WORKER);
        AppUser supervisorA = user(Role.SUPERVISOR);
        AppUser supervisorB = user(Role.SUPERVISOR);
        AppUser managerA = user(Role.SAFETY_MANAGER);
        AppUser admin = user(Role.ADMIN);

        memberships.save(new SiteMembership(workerA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(supervisorA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(supervisorB.getId(), siteB.getId()));
        memberships.save(new SiteMembership(managerA.getId(), siteA.getId()));
        // admin gets no membership on purpose

        workerAToken = mintAccessToken(workerA.getUsername());
        supervisorAToken = mintAccessToken(supervisorA.getUsername());
        supervisorBToken = mintAccessToken(supervisorB.getUsername());
        managerAToken = mintAccessToken(managerA.getUsername());
        adminToken = mintAccessToken(admin.getUsername());
    }

    private String streamUrl(Site site) {
        return "/api/v1/sites/" + site.getId() + "/conditions/stream";
    }

    // --- allowed: assigned supervisor/manager/admin connect ---
    //
    // Content type isn't asserted: it's only committed once the scheduled task writes its
    // first event on a background thread, which races a synchronous assertion. Async-started
    // + 200 already proves @PreAuthorize passed and a live emitter came back.

    @Test
    void assignedSupervisorCanOpenTheStream() throws Exception {
        mockMvc.perform(get(streamUrl(siteA)).header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(request().asyncStarted())
                .andExpect(status().isOk());
    }

    @Test
    void assignedSafetyManagerCanOpenTheStream() throws Exception {
        mockMvc.perform(get(streamUrl(siteA)).header("Authorization", "Bearer " + managerAToken))
                .andExpect(request().asyncStarted())
                .andExpect(status().isOk());
    }

    @Test
    void adminCanOpenTheStreamWithoutMembership() throws Exception {
        mockMvc.perform(get(streamUrl(siteA)).header("Authorization", "Bearer " + adminToken))
                .andExpect(request().asyncStarted())
                .andExpect(status().isOk());
    }

    // --- denied: role gate ---

    @Test
    void workerIsForbiddenFromTheConditionsStreamEvenAtTheirOwnSite() throws Exception {
        mockMvc.perform(get(streamUrl(siteA)).header("Authorization", "Bearer " + workerAToken))
                .andExpect(status().isForbidden());
    }

    // --- denied: object-level (cross-site) ---

    @Test
    void supervisorCannotOpenAnotherSitesStream() throws Exception {
        mockMvc.perform(get(streamUrl(siteA)).header("Authorization", "Bearer " + supervisorBToken))
                .andExpect(status().isForbidden());
    }

    // --- denied: authentication comes first ---

    @Test
    void unauthenticatedStreamRequestIs401NotForbidden() throws Exception {
        mockMvc.perform(get(streamUrl(siteA)))
                .andExpect(status().isUnauthorized());
    }

    // --- denied: unknown site reads as forbidden, not not-found ---

    @Test
    void unknownSiteIdIsForbiddenNotNotFound() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + UUID.randomUUID() + "/conditions/stream")
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isForbidden());
    }
}
