package com.crewsafe.admin.api;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration tests for {@link AdminUserController} (US-30) — role gate, registering an
 * already-existing Cognito identity, and role/status/site-membership management end to end
 * against a real Postgres, mirroring {@code PolicyVersionControllerTest}'s pattern.
 *
 * @author Jemilin Beulah
 */
@AutoConfigureMockMvc
class AdminUserControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;

    private String adminToken;
    private String adminId;
    private String supervisorToken;
    private String workerToken;
    private Site siteA;

    private String userWithToken(Role role) {
        String username = "admin-user-" + UUID.randomUUID();
        createCognitoUser(username);
        users.save(new AppUser(username, subFor(username), "Admin User Test " + role, role));
        return mintAccessToken(username);
    }

    /** A Cognito identity with no local {@code app_user} row yet — what a real "register" call
     * is expected to target. */
    private String freshCognitoSub() {
        String username = "unregistered-" + UUID.randomUUID();
        createCognitoUser(username);
        return subFor(username);
    }

    @BeforeEach
    void setUp() {
        String adminUsername = "admin-user-owner-" + UUID.randomUUID();
        createCognitoUser(adminUsername);
        AppUser admin = users.save(new AppUser(adminUsername, subFor(adminUsername), "Admin Owner", Role.ADMIN));
        adminId = admin.getId().toString();
        adminToken = mintAccessToken(adminUsername);

        supervisorToken = userWithToken(Role.SUPERVISOR);
        workerToken = userWithToken(Role.WORKER);

        siteA = sites.save(new Site("Admin Test Site " + UUID.randomUUID(),
                new BigDecimal("1.3"), new BigDecimal("103.8")));
    }

    private Map<String, Object> registerBody(String username, String cognitoSub, String role, List<String> siteIds) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("username", username);
        body.put("cognitoSub", cognitoSub);
        body.put("displayName", "Registered User");
        body.put("role", role);
        body.put("siteIds", siteIds);
        return body;
    }

    @Test
    void adminRegistersAnExistingCognitoIdentity() throws Exception {
        String sub = freshCognitoSub();
        String username = "registered-" + UUID.randomUUID();

        mockMvc.perform(post("/api/v1/admin/users")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                registerBody(username, sub, "WORKER", List.of(siteA.getId().toString())))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.username").value(username))
                .andExpect(jsonPath("$.role").value("WORKER"))
                .andExpect(jsonPath("$.siteIds[0]").value(siteA.getId().toString()));
    }

    @Test
    void duplicateCognitoSubReturns409() throws Exception {
        String sub = freshCognitoSub();
        Map<String, Object> body = registerBody("first-" + UUID.randomUUID(), sub, "WORKER", List.of());

        mockMvc.perform(post("/api/v1/admin/users")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated());

        Map<String, Object> secondBody = registerBody("second-" + UUID.randomUUID(), sub, "WORKER", List.of());
        mockMvc.perform(post("/api/v1/admin/users")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(secondBody)))
                .andExpect(status().isConflict());
    }

    @Test
    void adminChangesRoleAndStatus() throws Exception {
        AppUser target = users.save(new AppUser("role-change-target-" + UUID.randomUUID(),
                UUID.randomUUID().toString(), "Role Change Target", Role.WORKER));

        Map<String, Object> update = Map.of("role", "SUPERVISOR", "status", "INACTIVE");
        mockMvc.perform(patch("/api/v1/admin/users/" + target.getId())
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(update)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("SUPERVISOR"))
                .andExpect(jsonPath("$.status").value("INACTIVE"));
    }

    @Test
    void adminCannotChangeOwnRole() throws Exception {
        Map<String, Object> update = Map.of("role", "WORKER");
        mockMvc.perform(patch("/api/v1/admin/users/" + adminId)
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(update)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void adminGrantsThenRevokesASiteMembership() throws Exception {
        AppUser target = users.save(new AppUser("membership-target-" + UUID.randomUUID(),
                UUID.randomUUID().toString(), "Membership Target", Role.WORKER));

        mockMvc.perform(post("/api/v1/admin/users/" + target.getId() + "/site-memberships")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("siteId", siteA.getId().toString()))))
                .andExpect(status().isNoContent());

        mockMvc.perform(delete("/api/v1/admin/users/" + target.getId()
                        + "/site-memberships/" + siteA.getId())
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isNoContent());
    }

    @Test
    void grantingAnAlreadyHeldSiteReturns409() throws Exception {
        AppUser target = users.save(new AppUser("membership-dup-" + UUID.randomUUID(),
                UUID.randomUUID().toString(), "Membership Dup", Role.WORKER));
        memberships.save(new SiteMembership(target.getId(), siteA.getId()));

        mockMvc.perform(post("/api/v1/admin/users/" + target.getId() + "/site-memberships")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("siteId", siteA.getId().toString()))))
                .andExpect(status().isConflict());
    }

    @Test
    void supervisorCannotListUsers() throws Exception {
        mockMvc.perform(get("/api/v1/admin/users")
                        .header("Authorization", "Bearer " + supervisorToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void workerCannotRegisterAUser() throws Exception {
        mockMvc.perform(post("/api/v1/admin/users")
                        .header("Authorization", "Bearer " + workerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                registerBody("nope-" + UUID.randomUUID(), freshCognitoSub(), "WORKER", List.of()))))
                .andExpect(status().isForbidden());
    }

    @Test
    void unauthenticatedRequestIsRejected() throws Exception {
        mockMvc.perform(get("/api/v1/admin/users"))
                .andExpect(status().isUnauthorized());
    }
}
