package com.crewsafe.identity.security;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.common.audit.AuditEventRepository;
import com.crewsafe.common.audit.AuditEventType;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The acceptance tests behind US-01 - "RBAC and negative authorization tests pass".
 *
 * Covers AT-07 (a user cannot reach an object they are not assigned to) and AT-13 (an
 * unauthorized manager requesting another site is denied and the attempt is logged).
 */
@AutoConfigureMockMvc
class SiteAuthorizationTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private AuditEventRepository auditEvents;

    private Site siteA;
    private Site siteB;
    private String workerAToken;
    private String supervisorAToken;
    private String supervisorBToken;
    private String managerBToken;
    private String adminToken;
    private AppUser managerB;

    private AppUser user(Role role) {
        String username = "authz-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), "Authz Test " + role, role));
    }

    private Site site(String label) {
        return sites.save(new Site("Authz " + label + " " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
    }

    private String tokenFor(AppUser u) {
        return mintAccessToken(u.getUsername());
    }

    @BeforeEach
    void setUp() {
        siteA = site("Site A");
        siteB = site("Site B");

        AppUser workerA = user(Role.WORKER);
        AppUser supervisorA = user(Role.SUPERVISOR);
        AppUser supervisorB = user(Role.SUPERVISOR);
        managerB = user(Role.SAFETY_MANAGER);
        AppUser admin = user(Role.ADMIN);

        memberships.save(new SiteMembership(workerA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(supervisorA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(supervisorB.getId(), siteB.getId()));
        memberships.save(new SiteMembership(managerB.getId(), siteB.getId()));
        // admin gets no membership on purpose

        workerAToken = tokenFor(workerA);
        supervisorAToken = tokenFor(supervisorA);
        supervisorBToken = tokenFor(supervisorB);
        managerBToken = tokenFor(managerB);
        adminToken = tokenFor(admin);
    }

    // --- positive: assigned users get through ---

    @Test
    void assignedWorkerCanReadTheirOwnSite() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId())
                        .header("Authorization", "Bearer " + workerAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(siteA.getId().toString()));
    }

    @Test
    void assignedSupervisorCanOpenTheirDashboard() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/dashboard")
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OK"));
    }

    // --- AT-07: object-level denial ---

    @Test
    void workerCannotReadASiteTheyAreNotAssignedTo() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteB.getId())
                        .header("Authorization", "Bearer " + workerAToken))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("Forbidden"));
    }

    @Test
    void supervisorCannotOpenAnotherSitesDashboard() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/dashboard")
                        .header("Authorization", "Bearer " + supervisorBToken))
                .andExpect(status().isForbidden());
    }

    // --- AT-13: unauthorized manager, denied and logged ---

    @Test
    void safetyManagerIsDeniedASiteTheyAreNotAssignedTo() throws Exception {
        // A manager role does not imply access to every site. Cross-site oversight is
        // granted by membership, which is visible and auditable.
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/dashboard")
                        .header("Authorization", "Bearer " + managerBToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void deniedSiteAccessIsRecordedAsAnAuditEvent() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId())
                        .header("Authorization", "Bearer " + managerBToken))
                .andExpect(status().isForbidden());

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.ACCESS_DENIED))
                .anyMatch(e -> managerB.getId().equals(e.getActorId())
                        && siteA.getId().equals(e.getTargetId()));
    }

    // --- RBAC, independent of membership ---

    @Test
    void workerIsForbiddenFromTheSupervisorDashboardEvenAtTheirOwnSite() throws Exception {
        // Correct site, wrong role. Both layers have to pass.
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/dashboard")
                        .header("Authorization", "Bearer " + workerAToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void adminReachesAnySiteWithoutMembership() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId())
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/sites/" + siteB.getId() + "/dashboard")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk());
    }

    // --- authentication still comes first ---

    @Test
    void unauthenticatedSiteRequestIs401NotForbidden() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void unknownSiteIdIsForbiddenNotNotFound() throws Exception {
        // Authorization runs before the lookup, so a non-member cannot use response codes
        // to discover which site ids exist.
        mockMvc.perform(get("/api/v1/sites/" + UUID.randomUUID())
                        .header("Authorization", "Bearer " + workerAToken))
                .andExpect(status().isForbidden());
    }
}
