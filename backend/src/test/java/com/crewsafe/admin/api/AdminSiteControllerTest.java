package com.crewsafe.admin.api;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.repository.AppUserRepository;
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
import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration tests for {@link AdminSiteController} (US-30) — role gate and the
 * create/update/archive/unarchive lifecycle end to end against a real Postgres, mirroring
 * {@code PolicyVersionControllerTest}'s pattern.
 *
 * @author Jemilin Beulah
 */
@AutoConfigureMockMvc
class AdminSiteControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;

    private String adminToken;
    private String supervisorToken;
    private String safetyManagerToken;
    private String workerToken;

    private String user(Role role) {
        String username = "admin-site-" + UUID.randomUUID();
        createCognitoUser(username);
        users.save(new AppUser(username, subFor(username), "Admin Site Test " + role, role));
        return mintAccessToken(username);
    }

    @BeforeEach
    void setUp() {
        adminToken = user(Role.ADMIN);
        supervisorToken = user(Role.SUPERVISOR);
        safetyManagerToken = user(Role.SAFETY_MANAGER);
        workerToken = user(Role.WORKER);
    }

    private Map<String, Object> requestBody(String name) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        body.put("latitude", 1.3);
        body.put("longitude", 103.8);
        return body;
    }

    @Test
    void adminCreatesAndReadsBackASite() throws Exception {
        String response = mockMvc.perform(post("/api/v1/admin/sites")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(requestBody("New Site " + UUID.randomUUID()))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.archived").value(false))
                .andReturn().getResponse().getContentAsString();

        String siteId = objectMapper.readTree(response).get("id").asText();

        mockMvc.perform(get("/api/v1/admin/sites")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + siteId + "')]").exists());
    }

    @Test
    void duplicateNameReturns409() throws Exception {
        Map<String, Object> body = requestBody("Duplicate " + UUID.randomUUID());

        mockMvc.perform(post("/api/v1/admin/sites")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/v1/admin/sites")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isConflict());
    }

    @Test
    void archiveThenUnarchiveRoundTrips() throws Exception {
        Site site = sites.save(new Site("Archive Me " + UUID.randomUUID(),
                new BigDecimal("1.3"), new BigDecimal("103.8")));

        mockMvc.perform(post("/api/v1/admin/sites/" + site.getId() + "/archive")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archived").value(true));

        // Archived sites drop out of the normal switcher.
        mockMvc.perform(get("/api/v1/sites")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + site.getId() + "')]").doesNotExist());

        mockMvc.perform(post("/api/v1/admin/sites/" + site.getId() + "/unarchive")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archived").value(false));

        mockMvc.perform(get("/api/v1/sites")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + site.getId() + "')]").exists());
    }

    @Test
    void unknownSiteArchiveReturns404() throws Exception {
        mockMvc.perform(post("/api/v1/admin/sites/" + UUID.randomUUID() + "/archive")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isNotFound());
    }

    @Test
    void supervisorCannotListAdminSites() throws Exception {
        mockMvc.perform(get("/api/v1/admin/sites")
                        .header("Authorization", "Bearer " + supervisorToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void safetyManagerCannotCreateASite() throws Exception {
        mockMvc.perform(post("/api/v1/admin/sites")
                        .header("Authorization", "Bearer " + safetyManagerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(requestBody("Not Allowed " + UUID.randomUUID()))))
                .andExpect(status().isForbidden());
    }

    @Test
    void workerCannotListAdminSites() throws Exception {
        mockMvc.perform(get("/api/v1/admin/sites")
                        .header("Authorization", "Bearer " + workerToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void unauthenticatedRequestIsRejected() throws Exception {
        mockMvc.perform(get("/api/v1/admin/sites"))
                .andExpect(status().isUnauthorized());
    }
}
