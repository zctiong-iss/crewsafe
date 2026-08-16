package com.crewsafe.policy.api;

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

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Integration tests for {@link PolicyVersionController} (SCRUM-120) — endpoint access control
 * (role gate + site scoping) and the create/activate lifecycle end to end against a real
 * Postgres, mirroring {@code ShiftControllerTest}'s pattern.
 *
 * @author Jemilin Beulah
 */
@AutoConfigureMockMvc
class PolicyVersionControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;

    private Site siteA;
    private String safetyManagerAToken;
    private String supervisorAToken;
    private String workerAToken;
    private String safetyManagerBToken;

    private AppUser user(Role role) {
        String username = "policy-version-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), "Policy Test " + role, role));
    }

    private Site site(String label) {
        return sites.save(new Site("Policy " + label + " " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
    }

    @BeforeEach
    void setUp() {
        siteA = site("Site A");
        Site siteB = site("Site B");

        AppUser safetyManagerA = user(Role.SAFETY_MANAGER);
        AppUser supervisorA = user(Role.SUPERVISOR);
        AppUser workerA = user(Role.WORKER);
        AppUser safetyManagerB = user(Role.SAFETY_MANAGER);

        memberships.save(new SiteMembership(safetyManagerA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(supervisorA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(workerA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(safetyManagerB.getId(), siteB.getId()));

        safetyManagerAToken = mintAccessToken(safetyManagerA.getUsername());
        supervisorAToken = mintAccessToken(supervisorA.getUsername());
        workerAToken = mintAccessToken(workerA.getUsername());
        safetyManagerBToken = mintAccessToken(safetyManagerB.getUsername());
    }

    private Map<String, Object> createRequestBody(String versionLabel) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("versionLabel", versionLabel);
        body.put("source", "MOM Work-Rest Guidelines 2026 Rev B");
        body.put("effectiveDate", LocalDate.now().toString());
        body.put("wbgtThresholdUnacclimatisedLight", 25.0);
        body.put("wbgtThresholdUnacclimatisedModerate", 23.0);
        body.put("wbgtThresholdUnacclimatisedHeavy", 21.0);
        body.put("wbgtThresholdPartialLight", 26.0);
        body.put("wbgtThresholdPartialModerate", 24.0);
        body.put("wbgtThresholdPartialHeavy", 22.0);
        body.put("wbgtThresholdFullLight", 28.0);
        body.put("wbgtThresholdFullModerate", 26.0);
        body.put("wbgtThresholdFullHeavy", 24.0);
        body.put("wbgtEmergencyStop", 33.0);
        return body;
    }

    @Test
    void safetyManagerCreatesFirstVersion_autoActivated() throws Exception {
        mockMvc.perform(post("/api/v1/sites/" + siteA.getId() + "/policy-versions")
                        .header("Authorization", "Bearer " + safetyManagerAToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequestBody("MOM-WBGT-2026.1"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.versionLabel").value("MOM-WBGT-2026.1"))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.siteId").value(siteA.getId().toString()));

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/policy-versions/active")
                        .header("Authorization", "Bearer " + safetyManagerAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.versionLabel").value("MOM-WBGT-2026.1"));
    }

    @Test
    void secondVersionIsDraftUntilActivated() throws Exception {
        mockMvc.perform(post("/api/v1/sites/" + siteA.getId() + "/policy-versions")
                        .header("Authorization", "Bearer " + safetyManagerAToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequestBody("MOM-WBGT-2026.1"))))
                .andExpect(status().isCreated());

        String secondBody = objectMapper.writeValueAsString(createRequestBody("MOM-WBGT-2026.2"));
        String response = mockMvc.perform(post("/api/v1/sites/" + siteA.getId() + "/policy-versions")
                        .header("Authorization", "Bearer " + safetyManagerAToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(secondBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andReturn().getResponse().getContentAsString();

        String secondId = objectMapper.readTree(response).get("id").asText();

        // Active version is still the first — activating hasn't happened yet.
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/policy-versions/active")
                        .header("Authorization", "Bearer " + safetyManagerAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.versionLabel").value("MOM-WBGT-2026.1"));

        mockMvc.perform(post("/api/v1/sites/" + siteA.getId() + "/policy-versions/" + secondId + "/activate")
                        .header("Authorization", "Bearer " + safetyManagerAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.versionLabel").value("MOM-WBGT-2026.2"));

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/policy-versions/active")
                        .header("Authorization", "Bearer " + safetyManagerAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.versionLabel").value("MOM-WBGT-2026.2"));

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/policy-versions")
                        .header("Authorization", "Bearer " + safetyManagerAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void getActiveVersion_noneConfigured_returns404() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/policy-versions/active")
                        .header("Authorization", "Bearer " + safetyManagerAToken))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    void getEffectiveVersion_noSiteVersion_fallsBackToCompanyDefault() throws Exception {
        // V18 seeds one company-wide default (siteId null) as ACTIVE; siteA has configured
        // nothing of its own, so /effective must resolve to it instead of 404ing.
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/policy-versions/effective")
                        .header("Authorization", "Bearer " + safetyManagerAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.siteId").doesNotExist())
                .andExpect(jsonPath("$.versionLabel").value("MOM-WBGT-2026-DEFAULT"));
    }

    @Test
    void getEffectiveVersion_siteHasOwnVersion_prefersItOverCompanyDefault() throws Exception {
        mockMvc.perform(post("/api/v1/sites/" + siteA.getId() + "/policy-versions")
                        .header("Authorization", "Bearer " + safetyManagerAToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequestBody("MOM-WBGT-2026.1"))))
                .andExpect(status().isCreated());

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/policy-versions/effective")
                        .header("Authorization", "Bearer " + safetyManagerAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.siteId").value(siteA.getId().toString()))
                .andExpect(jsonPath("$.versionLabel").value("MOM-WBGT-2026.1"));
    }

    @Test
    void duplicateVersionLabel_returns409() throws Exception {
        mockMvc.perform(post("/api/v1/sites/" + siteA.getId() + "/policy-versions")
                        .header("Authorization", "Bearer " + safetyManagerAToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequestBody("MOM-WBGT-2026.1"))))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/v1/sites/" + siteA.getId() + "/policy-versions")
                        .header("Authorization", "Bearer " + safetyManagerAToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequestBody("MOM-WBGT-2026.1"))))
                .andExpect(status().isConflict());
    }

    @Test
    void thresholdsOutOfOrder_returns400() throws Exception {
        Map<String, Object> body = createRequestBody("MOM-WBGT-2026.1");
        body.put("wbgtThresholdUnacclimatisedLight", 20.0); // now below moderate (23.0)

        mockMvc.perform(post("/api/v1/sites/" + siteA.getId() + "/policy-versions")
                        .header("Authorization", "Bearer " + safetyManagerAToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void supervisorCannotCreateAVersion() throws Exception {
        mockMvc.perform(post("/api/v1/sites/" + siteA.getId() + "/policy-versions")
                        .header("Authorization", "Bearer " + supervisorAToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequestBody("MOM-WBGT-2026.1"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void workerCannotReadTheCatalogue() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/policy-versions")
                        .header("Authorization", "Bearer " + workerAToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void supervisorCanReadTheCatalogue() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/policy-versions")
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isOk());
    }

    @Test
    void safetyManagerFromAnotherSiteCannotCreateAVersion() throws Exception {
        mockMvc.perform(post("/api/v1/sites/" + siteA.getId() + "/policy-versions")
                        .header("Authorization", "Bearer " + safetyManagerBToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createRequestBody("MOM-WBGT-2026.1"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void unauthenticatedRequestIsRejected() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/policy-versions"))
                .andExpect(status().isUnauthorized());
    }
}
