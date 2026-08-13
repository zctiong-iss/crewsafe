package com.crewsafe.operation.api;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.repository.RecommendationRepository;
import com.crewsafe.operation.service.AgentDraftService;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The supervisor-facing half of SCRUM-289: who may ask for a draft, and what comes back.
 *
 * <p>{@link AgentDraftService} is mocked here on purpose. Whether the agent drafts a good plan
 * is settled by {@code AgentDraftServiceTest} against every degraded path; what this class has
 * to establish is different and not covered there — that the endpoint is site-scoped and
 * role-gated like every other write in the module, that a draft comes back 201 rather than 200,
 * and that SCRUM-359's evidence block actually reaches the wire rather than stopping at the
 * entity.
 *
 * @author Abu Bakar
 */
@AutoConfigureMockMvc
class AgentDraftEndpointTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private ShiftRepository shifts;
    @Autowired private RecommendationRepository recommendations;

    @MockitoBean private AgentDraftService agentDraftService;

    private Site siteA;
    private Shift shiftA;
    private String supervisorAToken;
    private String safetyManagerAToken;
    private String workerAToken;
    private String supervisorBToken;

    @BeforeEach
    void setUp() {
        siteA = site("A");
        Site siteB = site("B");

        supervisorAToken = tokenFor(Role.SUPERVISOR, siteA);
        safetyManagerAToken = tokenFor(Role.SAFETY_MANAGER, siteA);
        workerAToken = tokenFor(Role.WORKER, siteA);
        supervisorBToken = tokenFor(Role.SUPERVISOR, siteB);

        shiftA = shifts.save(new Shift(siteA.getId(), Instant.now().truncatedTo(ChronoUnit.SECONDS),
                Instant.now().plus(8, ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS)));
    }

    @Test
    @DisplayName("A supervisor gets 201 and a PENDING_APPROVAL plan carrying its evidence")
    void supervisorGeneratesADraft() throws Exception {
        when(agentDraftService.generate(any(), any(), any())).thenReturn(Optional.of(seedDraft()));

        generate(supervisorAToken)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING_APPROVAL"))
                .andExpect(jsonPath("$.modelVersion").value("global.anthropic.claude-haiku-4-5-20251001-v1:0"))
                .andExpect(jsonPath("$.mitigations.length()").value(1))
                .andExpect(jsonPath("$.mitigations[0].actionCode").value("REST_15_MIN_HOURLY"))
                .andExpect(jsonPath("$.evidence.observedWbgt").value(32.5))
                .andExpect(jsonPath("$.evidence.currentBand").value("32_TO_BELOW_33"))
                .andExpect(jsonPath("$.evidence.freshness").value("LIVE"))
                .andExpect(jsonPath("$.evidence.stationId").value("S50"))
                .andExpect(jsonPath("$.evidence.lightningState").value("CLEAR"));
    }

    @Test
    @DisplayName("Evidence is additive: a pre-SCRUM-359 recommendation still reads back cleanly")
    void olderRecommendationsHaveNullEvidence() throws Exception {
        Recommendation legacy = recommendations.save(Recommendation.builder()
                .id(UUID.randomUUID())
                .shiftId(shiftA.getId())
                .policyVersion("MOM-WBGT-2026.1")
                .draftPlan("{\"mitigations\":[]}")
                .status(Recommendation.RecommendationStatus.PENDING_APPROVAL)
                .rationale("Drafted before the evidence block existed")
                .createdAt(Instant.now())
                .build());

        mockMvc.perform(get(recommendationsUrl() + "/" + legacy.getId())
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.evidence").doesNotExist())
                .andExpect(jsonPath("$.modelVersion").doesNotExist());
    }

    @Test
    @DisplayName("An unknown shift is a 404, not an empty draft")
    void unknownShiftIs404() throws Exception {
        when(agentDraftService.generate(any(), any(), any())).thenReturn(Optional.empty());

        generate(supervisorAToken).andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("A safety manager may read a draft but not trigger one — it is a billed, actionable write")
    void safetyManagerCannotGenerate() throws Exception {
        generate(safetyManagerAToken).andExpect(status().isForbidden());
        verify(agentDraftService, never()).generate(any(), any(), any());
    }

    @Test
    void workerCannotGenerate() throws Exception {
        generate(workerAToken).andExpect(status().isForbidden());
        verify(agentDraftService, never()).generate(any(), any(), any());
    }

    @Test
    @DisplayName("A supervisor at another site cannot generate for this one")
    void supervisorFromAnotherSiteCannotGenerate() throws Exception {
        generate(supervisorBToken).andExpect(status().isForbidden());
        verify(agentDraftService, never()).generate(any(), any(), any());
    }

    @Test
    void unauthenticatedCannotGenerate() throws Exception {
        mockMvc.perform(post(recommendationsUrl() + "/generate"))
                .andExpect(status().isUnauthorized());
        verify(agentDraftService, never()).generate(any(), any(), any());
    }

    // --- helpers ---

    private ResultActions generate(String token) throws Exception {
        return mockMvc.perform(post(recommendationsUrl() + "/generate")
                .header("Authorization", "Bearer " + token));
    }

    private String recommendationsUrl() {
        return "/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftA.getId() + "/recommendations";
    }

    private Recommendation seedDraft() {
        return recommendations.save(Recommendation.builder()
                .id(UUID.randomUUID())
                .shiftId(shiftA.getId())
                .policyVersion("MOM-WBGT-2026.1")
                .draftPlan("""
                        {"mitigations":[{"priority":"HIGH","action":"Rest 15 minutes in shade every hour",\
                        "rationale":"WBGT exceeds this worker's threshold","estimatedImpact":"Lowers core temperature",\
                        "actionCode":"REST_15_MIN_HOURLY","category":"REST","origin":"MANDATORY",\
                        "ruleReference":"UNACCLIMATISED_HEAVY_WORK_RULE"}]}""")
                .status(Recommendation.RecommendationStatus.PENDING_APPROVAL)
                .rationale("WBGT is 32.5°C, between 32°C and 33°C, assessed against MOM-WBGT-2026.1.")
                .evidence("""
                        {"observedWbgt":32.5,"forecastWbgt30m":32.5,"currentBand":"32_TO_BELOW_33",\
                        "forecastBand":"32_TO_BELOW_33","observedAt":"2026-08-14T03:55:00Z","freshness":"LIVE",\
                        "source":"NEA","stationId":"S50","lightningState":"CLEAR"}""")
                .modelVersion("global.anthropic.claude-haiku-4-5-20251001-v1:0")
                .createdAt(Instant.now())
                .build());
    }

    private String tokenFor(Role role, Site site) {
        String username = "agent-draft-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), "Agent Draft " + role, role));
        memberships.save(new SiteMembership(created.getId(), site.getId()));
        return mintAccessToken(username);
    }

    private Site site(String label) {
        return sites.save(new Site("Agent Draft " + label + " " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
    }
}
