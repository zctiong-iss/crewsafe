package com.crewsafe.site;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.domain.UserStatus;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /api/v1/sites/{siteId}/workers} (SCRUM-159/160-fix) — candidates for a
 * shift-assignment worker picker. Nothing returned a site's workers before this; the
 * create-shift form (SCRUM-161) had no way to populate one.
 *
 * @author Abu Bakar
 */
@AutoConfigureMockMvc
class SiteWorkersTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;

    private Site siteA;
    private Site siteB;
    private String supervisorAToken;
    private String supervisorBToken;

    private AppUser user(Role role, UserStatus status) {
        String username = "siteworkers-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), "Site Workers Test " + role, role));
        if (status != UserStatus.ACTIVE) {
            created.setStatus(status);
            created = users.save(created);
        }
        return created;
    }

    private AppUser worker(String displayName, Site site) {
        String username = "siteworkers-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), displayName, Role.WORKER));
        memberships.save(new SiteMembership(created.getId(), site.getId()));
        return created;
    }

    private Site site(String label) {
        return sites.save(new Site("Site Workers " + label + " " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
    }

    @BeforeEach
    void setUp() {
        siteA = site("A");
        siteB = site("B");

        AppUser supervisorA = user(Role.SUPERVISOR, UserStatus.ACTIVE);
        AppUser supervisorB = user(Role.SUPERVISOR, UserStatus.ACTIVE);
        memberships.save(new SiteMembership(supervisorA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(supervisorB.getId(), siteB.getId()));

        supervisorAToken = mintAccessToken(supervisorA.getUsername());
        supervisorBToken = mintAccessToken(supervisorB.getUsername());
    }

    @Test
    void listsOnlyActiveWorkerRoleMembersOfTheSite() throws Exception {
        AppUser activeWorker = worker("Priya", siteA);

        AppUser inactiveWorker = user(Role.WORKER, UserStatus.INACTIVE);
        memberships.save(new SiteMembership(inactiveWorker.getId(), siteA.getId()));

        AppUser supervisorAtSite = user(Role.SUPERVISOR, UserStatus.ACTIVE);
        memberships.save(new SiteMembership(supervisorAtSite.getId(), siteA.getId()));

        worker("Worker At Other Site", siteB);

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/workers")
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(activeWorker.getId().toString()))
                .andExpect(jsonPath("$[0].displayName").value("Priya"));
    }

    @Test
    void resultsAreSortedByDisplayName() throws Exception {
        worker("Zed", siteA);
        worker("Amy", siteA);

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/workers")
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].displayName").value("Amy"))
                .andExpect(jsonPath("$[1].displayName").value("Zed"));
    }

    @Test
    void siteWithNoWorkersReturnsAnEmptyListNotAnError() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/workers")
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void supervisorFromAnotherSiteCannotListWorkers() throws Exception {
        worker("Priya", siteA);

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/workers")
                        .header("Authorization", "Bearer " + supervisorBToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void workerRoleCannotListSiteWorkers() throws Exception {
        AppUser theWorker = worker("Priya", siteA);
        String workerToken = mintAccessToken(theWorker.getUsername());

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/workers")
                        .header("Authorization", "Bearer " + workerToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void requiresAuthentication() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/workers"))
                .andExpect(status().isUnauthorized());
    }
}
