package com.crewsafe.site;

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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /api/v1/sites} — the list the web app's site switcher is built from.
 *
 * <p>This endpoint expresses FR-03 as a filter rather than a guard, which is a second place
 * the same rule lives. These tests exist to catch it drifting from
 * {@code SiteAccessEvaluator}: a site that does not appear in this list must also be
 * unreachable directly, and vice versa.
 *
 * @author Jemilin Beulah
 */
@AutoConfigureMockMvc
class SiteListingTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;

    private Site alpha;
    private Site beta;

    @BeforeEach
    void createSites() {
        alpha = sites.save(new Site("Alpha " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
        beta = sites.save(new Site("Beta " + UUID.randomUUID(),
                new BigDecimal("1.310000"), new BigDecimal("103.810000")));
    }

    private String tokenFor(Role role, Site... assigned) {
        String username = "sitelist-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser user = users.save(new AppUser(username, subFor(username), "Site List Test", role));
        for (Site site : assigned) {
            memberships.save(new SiteMembership(user.getId(), site.getId()));
        }
        return mintAccessToken(username);
    }

    @Test
    void listsOnlySitesTheUserIsAssignedTo() throws Exception {
        String token = tokenFor(Role.WORKER, alpha);

        mockMvc.perform(get("/api/v1/sites").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + alpha.getId() + "')]").exists())
                .andExpect(jsonPath("$[?(@.id == '" + beta.getId() + "')]").doesNotExist());
    }

    /**
     * The pairing that matters: a site absent from the list is also unreachable directly.
     * If these two ever disagree, the UI is either hiding something the user may open or
     * offering something that will 403 when clicked.
     */
    @Test
    void aSiteMissingFromTheListIsAlsoForbiddenDirectly() throws Exception {
        String token = tokenFor(Role.WORKER, alpha);

        mockMvc.perform(get("/api/v1/sites/" + beta.getId()).header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    /** ADMIN bypasses membership here exactly as it does in SiteAccessEvaluator. */
    @Test
    void adminSeesSitesItHasNoMembershipOf() throws Exception {
        String token = tokenFor(Role.ADMIN);

        mockMvc.perform(get("/api/v1/sites").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + alpha.getId() + "')]").exists())
                .andExpect(jsonPath("$[?(@.id == '" + beta.getId() + "')]").exists());
    }

    /**
     * SAFETY_MANAGER reaches multiple sites by being granted each, not by role — the
     * decision documented in SiteAccessEvaluator. Asserted here so the filter cannot quietly
     * become more generous than the guard.
     */
    @Test
    void safetyManagerSeesOnlyAssignedSites() throws Exception {
        String token = tokenFor(Role.SAFETY_MANAGER, alpha);

        mockMvc.perform(get("/api/v1/sites").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + alpha.getId() + "')]").exists())
                .andExpect(jsonPath("$[?(@.id == '" + beta.getId() + "')]").doesNotExist());
    }

    /** A new starter with no memberships is authenticated and correctly sees nothing. */
    @Test
    void userWithNoMembershipsGetsAnEmptyListNotAnError() throws Exception {
        String token = tokenFor(Role.WORKER);

        mockMvc.perform(get("/api/v1/sites").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == '" + alpha.getId() + "')]").doesNotExist())
                .andExpect(jsonPath("$[?(@.id == '" + beta.getId() + "')]").doesNotExist());
    }

    @Test
    void requiresAuthentication() throws Exception {
        mockMvc.perform(get("/api/v1/sites"))
                .andExpect(status().isUnauthorized());
    }
}
