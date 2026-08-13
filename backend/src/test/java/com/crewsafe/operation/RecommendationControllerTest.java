package com.crewsafe.operation;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.common.audit.AuditEventRepository;
import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.repository.ActionDispatchRepository;
import com.crewsafe.operation.repository.RecommendationRepository;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * SCRUM-119: a supervisor reads a shift's AI-drafted recommendations and records an
 * approve/edit/reject decision on one. Recommendations here are seeded directly via
 * {@link RecommendationRepository} rather than through an endpoint — creating one is
 * SCRUM-118 (the agent), out of scope for this ticket, the same way {@code ActionDispatch}
 * rows were seeded directly before SCRUM-185 built the service that creates them for real.
 *
 * @author Abu Bakar
 */
@AutoConfigureMockMvc
class RecommendationControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private ShiftRepository shifts;
    @Autowired private ShiftAssignmentRepository shiftAssignments;
    @Autowired private RecommendationRepository recommendations;
    @Autowired private ActionDispatchRepository actionDispatches;
    @Autowired private AuditEventRepository auditEvents;

    private Site siteA;
    private Shift shiftA;
    private AppUser supervisorA;
    private AppUser workerA;
    private String supervisorAToken;
    private String safetyManagerAToken;
    private String workerAToken;
    private String supervisorBToken;

    private AppUser user(Role role, Site site) {
        String username = "recommendation-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), "Recommendation Test " + role, role));
        memberships.save(new SiteMembership(created.getId(), site.getId()));
        return created;
    }

    private Site site(String label) {
        return sites.save(new Site("Recommendation " + label + " " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
    }

    @BeforeEach
    void setUp() {
        siteA = site("A");
        Site siteB = site("B");

        supervisorA = user(Role.SUPERVISOR, siteA);
        AppUser safetyManagerA = user(Role.SAFETY_MANAGER, siteA);
        workerA = user(Role.WORKER, siteA);
        AppUser supervisorB = user(Role.SUPERVISOR, siteB);

        supervisorAToken = mintAccessToken(supervisorA.getUsername());
        safetyManagerAToken = mintAccessToken(safetyManagerA.getUsername());
        workerAToken = mintAccessToken(workerA.getUsername());
        supervisorBToken = mintAccessToken(supervisorB.getUsername());

        shiftA = shifts.save(new Shift(siteA.getId(), Instant.now().truncatedTo(ChronoUnit.SECONDS),
                Instant.now().plus(8, ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS)));
    }

    private void assign(Shift shift, AppUser worker) {
        shiftAssignments.save(new ShiftAssignment(shift.getId(), worker.getId(), "General duties",
                Intensity.MODERATE, null));
    }

    private Recommendation recommendation(Shift shift, String draftPlanJson) {
        return recommendations.save(Recommendation.builder()
                .id(UUID.randomUUID())
                .shiftId(shift.getId())
                .policyVersion("HS-32-HEAVY-v1")
                .draftPlan(draftPlanJson)
                .status(Recommendation.RecommendationStatus.PENDING_APPROVAL)
                .rationale("WBGT forecast to cross 32°C within the shift window")
                .createdAt(Instant.now())
                .build());
    }

    private static final String DRAFT_PLAN = """
            {"mitigations":[{"priority":"HIGH","action":"Reduce work hours to 20 min active / 10 min rest",\
            "rationale":"WBGT forecast exceeds safe continuous work limits","estimatedImpact":"10-15% reduction in heat stress risk"}]}""";

    /**
     * A plan drafted after SCRUM-119: every mitigation carries an action code the mobile app has
     * a translation for. {@code REST_15_MIN_HOURLY} is the interesting one — it is a recurring
     * recommendation code with no dispatch form of its own, so it must arrive as
     * {@code REST_15_MIN}.
     */
    private static final String CODED_DRAFT_PLAN = """
            {"mitigations":[{"priority":"HIGH","action":"Rest 15 minutes every hour",\
            "rationale":"Forecast WBGT reaches the 33 band on heavy tasks","estimatedImpact":"Keeps core temperature within MOM guidance",\
            "actionCode":"REST_15_MIN_HOURLY","category":"REST"},\
            {"priority":"MEDIUM","action":"Drink water at least once an hour",\
            "rationale":"Sustained sweat loss","estimatedImpact":"Maintains hydration",\
            "actionCode":"HYDRATE_HOURLY","category":"HYDRATION"}]}""";

    private ResultActions getAuthenticated(String url, String token) throws Exception {
        return mockMvc.perform(get(url).header("Authorization", "Bearer " + token));
    }

    private ResultActions postJson(String url, String token, Object body) throws Exception {
        return mockMvc.perform(post(url)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    private Map<String, Object> decisionBody(String decision, String reason, Object editedPlan) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("decision", decision);
        if (reason != null) {
            body.put("reason", reason);
        }
        if (editedPlan != null) {
            body.put("editedPlan", editedPlan);
        }
        return body;
    }

    private String recommendationsUrl(Shift shift) {
        return "/api/v1/sites/" + siteA.getId() + "/shifts/" + shift.getId() + "/recommendations";
    }

    // --- list / get ---

    @Test
    void supervisorListsRecommendationsWithDraftMitigationsParsed() throws Exception {
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        getAuthenticated(recommendationsUrl(shiftA), supervisorAToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(r.getId().toString()))
                .andExpect(jsonPath("$[0].status").value("PENDING_APPROVAL"))
                .andExpect(jsonPath("$[0].mitigations.length()").value(1))
                .andExpect(jsonPath("$[0].mitigations[0].priority").value("HIGH"))
                .andExpect(jsonPath("$[0].approval").doesNotExist());
    }

    @Test
    void safetyManagerCanListRecommendations() throws Exception {
        recommendation(shiftA, DRAFT_PLAN);

        getAuthenticated(recommendationsUrl(shiftA), safetyManagerAToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void workerCannotListRecommendations() throws Exception {
        recommendation(shiftA, DRAFT_PLAN);

        getAuthenticated(recommendationsUrl(shiftA), workerAToken)
                .andExpect(status().isForbidden());
    }

    @Test
    void listingForAnUnknownShiftIs404() throws Exception {
        getAuthenticated("/api/v1/sites/" + siteA.getId() + "/shifts/" + UUID.randomUUID() + "/recommendations",
                        supervisorAToken)
                .andExpect(status().isNotFound());
    }

    @Test
    void gettingARecommendationFromTheWrongShiftIs404() throws Exception {
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);
        Shift otherShift = shifts.save(new Shift(siteA.getId(), Instant.now().truncatedTo(ChronoUnit.SECONDS),
                Instant.now().plus(8, ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS)));

        getAuthenticated(recommendationsUrl(otherShift) + "/" + r.getId(), supervisorAToken)
                .andExpect(status().isNotFound());
    }

    @Test
    void requiresAuthentication() throws Exception {
        mockMvc.perform(get(recommendationsUrl(shiftA)))
                .andExpect(status().isUnauthorized());
    }

    // --- decide: approve ---

    @Test
    void supervisorApprovesARecommendation() throws Exception {
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        postJson(recommendationsUrl(shiftA) + "/" + r.getId() + "/decision", supervisorAToken,
                        decisionBody("APPROVED", null, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.approval.decision").value("APPROVED"))
                .andExpect(jsonPath("$.approval.approverId").value(supervisorA.getId().toString()))
                .andExpect(jsonPath("$.mitigations[0].priority").value("HIGH"));

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.RECOMMENDATION_APPROVED))
                .anyMatch(e -> r.getId().equals(e.getTargetId()) && supervisorA.getId().equals(e.getActorId()));
    }

    @Test
    void decidingTwiceIsConflict() throws Exception {
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        postJson(recommendationsUrl(shiftA) + "/" + r.getId() + "/decision", supervisorAToken,
                        decisionBody("APPROVED", null, null))
                .andExpect(status().isOk());

        postJson(recommendationsUrl(shiftA) + "/" + r.getId() + "/decision", supervisorAToken,
                        decisionBody("APPROVED", null, null))
                .andExpect(status().isConflict());
    }

    @Test
    void decidingAnUnknownRecommendationIs404() throws Exception {
        postJson(recommendationsUrl(shiftA) + "/" + UUID.randomUUID() + "/decision", supervisorAToken,
                        decisionBody("APPROVED", null, null))
                .andExpect(status().isNotFound());
    }

    // --- decide: reject ---

    @Test
    void rejectingWithoutReasonIsBadRequest() throws Exception {
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        postJson(recommendationsUrl(shiftA) + "/" + r.getId() + "/decision", supervisorAToken,
                        decisionBody("REJECTED", null, null))
                .andExpect(status().isBadRequest());
    }

    @Test
    void supervisorRejectsARecommendationWithReason() throws Exception {
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        postJson(recommendationsUrl(shiftA) + "/" + r.getId() + "/decision", supervisorAToken,
                        decisionBody("REJECTED", "Crew already rotated off heavy tasks this shift", null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.approval.decision").value("REJECTED"))
                .andExpect(jsonPath("$.approval.reason").value("Crew already rotated off heavy tasks this shift"));

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.RECOMMENDATION_REJECTED))
                .anyMatch(e -> r.getId().equals(e.getTargetId()));
    }

    // --- decide: edit ---

    @Test
    void editingWithoutEditedPlanIsBadRequest() throws Exception {
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        postJson(recommendationsUrl(shiftA) + "/" + r.getId() + "/decision", supervisorAToken,
                        decisionBody("EDITED", null, null))
                .andExpect(status().isBadRequest());
    }

    @Test
    void supervisorEditsARecommendationRetainingBothVersions() throws Exception {
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        var editedPlan = java.util.List.of(Map.of(
                "priority", "MEDIUM",
                "action", "Reduce work hours to 30 min active / 10 min rest",
                "rationale", "Crew has partial acclimatisation, full 20/10 split not warranted",
                "estimatedImpact", "8-10% reduction in heat stress risk"));

        postJson(recommendationsUrl(shiftA) + "/" + r.getId() + "/decision", supervisorAToken,
                        decisionBody("EDITED", null, editedPlan))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.approval.decision").value("EDITED"))
                // The original draft is untouched...
                .andExpect(jsonPath("$.mitigations[0].priority").value("HIGH"))
                .andExpect(jsonPath("$.mitigations[0].action").value("Reduce work hours to 20 min active / 10 min rest"))
                // ...while the approval carries what was actually approved.
                .andExpect(jsonPath("$.approval.editedMitigations[0].priority").value("MEDIUM"))
                .andExpect(jsonPath("$.approval.editedMitigations[0].action")
                        .value("Reduce work hours to 30 min active / 10 min rest"));

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.RECOMMENDATION_EDITED))
                .anyMatch(e -> r.getId().equals(e.getTargetId()));
    }

    // --- authorization on decide ---

    @Test
    void safetyManagerCannotDecide() throws Exception {
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        postJson(recommendationsUrl(shiftA) + "/" + r.getId() + "/decision", safetyManagerAToken,
                        decisionBody("APPROVED", null, null))
                .andExpect(status().isForbidden());
    }

    @Test
    void workerCannotDecide() throws Exception {
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        postJson(recommendationsUrl(shiftA) + "/" + r.getId() + "/decision", workerAToken,
                        decisionBody("APPROVED", null, null))
                .andExpect(status().isForbidden());
    }

    @Test
    void supervisorFromAnotherSiteCannotDecide() throws Exception {
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        postJson(recommendationsUrl(shiftA) + "/" + r.getId() + "/decision", supervisorBToken,
                        decisionBody("APPROVED", null, null))
                .andExpect(status().isForbidden());
    }

    // --- SCRUM-193: fan-out to worker dispatches ---

    private UUID decideAndExtractApprovalId(Recommendation r, String decision, String reason,
                                             Object editedPlan) throws Exception {
        String body = postJson(recommendationsUrl(shiftA) + "/" + r.getId() + "/decision", supervisorAToken,
                        decisionBody(decision, reason, editedPlan))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(objectMapper.readTree(body).get("approval").get("id").asText());
    }

    @Test
    void approvingDispatchesToEveryWorkerAssignedToTheShift() throws Exception {
        AppUser secondWorker = user(Role.WORKER, siteA);
        assign(shiftA, workerA);
        assign(shiftA, secondWorker);
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        UUID approvalId = decideAndExtractApprovalId(r, "APPROVED", null, null);

        List<ActionDispatch> dispatches = actionDispatches.findByApprovalId(approvalId);
        assertThat(dispatches).hasSize(2);
        assertThat(dispatches).allMatch(d -> d.getActionCode().equals("AI_RECOMMENDED_ACTION"));
        assertThat(dispatches).allMatch(d ->
                d.getInstruction().equals("Reduce work hours to 20 min active / 10 min rest"));
        assertThat(dispatches).allMatch(d -> d.getStatus() == ActionDispatch.ActionDispatchStatus.PENDING);
        assertThat(dispatches).extracting(d -> d.getWorker().getId())
                .containsExactlyInAnyOrder(workerA.getId(), secondWorker.getId());
    }

    // --- SCRUM-119: the dispatched code is the mitigation's own, mapped for dispatch ---

    @Test
    void approvingDispatchesEachMitigationUnderItsOwnTranslatedCode() throws Exception {
        assign(shiftA, workerA);
        Recommendation r = recommendation(shiftA, CODED_DRAFT_PLAN);

        UUID approvalId = decideAndExtractApprovalId(r, "APPROVED", null, null);

        List<ActionDispatch> dispatches = actionDispatches.findByApprovalId(approvalId);
        // Before this, both went out as AI_RECOMMENDED_ACTION — a code no locale translates, so
        // the worker's inbox showed two identical rows of humanised English.
        assertThat(dispatches).extracting(ActionDispatch::getActionCode)
                .containsExactlyInAnyOrder("REST_15_MIN", "HYDRATE");
    }

    @Test
    void aPlanWithoutActionCodesStillDispatchesUnderTheLegacyPlaceholder() throws Exception {
        assign(shiftA, workerA);
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        UUID approvalId = decideAndExtractApprovalId(r, "APPROVED", null, null);

        // Rows drafted before SCRUM-119 have no code to use. They must stay decidable rather than
        // failing — the placeholder is the honest answer, not a regression.
        assertThat(actionDispatches.findByApprovalId(approvalId))
                .allMatch(d -> d.getActionCode().equals("AI_RECOMMENDED_ACTION"));
    }

    // --- SCRUM-288 (closing SCRUM-243): per-worker targeting via appliesTo ---

    /** A plan whose one mitigation names a single worker — the other worker on the shift must
     * not receive it. {@code %s} is that worker's id, filled in per test. */
    private static final String TARGETED_PLAN_TEMPLATE = """
            {"mitigations":[{"priority":"HIGH","action":"Rotate off heavy duty for the rest of the shift",\
            "rationale":"Unacclimatised on heavy-intensity work","estimatedImpact":"Reduces exposure while acclimatising",\
            "actionCode":"ROTATE_TO_LIGHT_DUTY","category":"WORK_SCHEDULING","origin":"ADVISORY",\
            "ruleReference":"UNACCLIMATISED_HEAVY_WORK_RULE","appliesTo":["%s"]}]}""";

    @Test
    void aMitigationNamingOneWorkerDispatchesOnlyToThatWorker() throws Exception {
        AppUser secondWorker = user(Role.WORKER, siteA);
        assign(shiftA, workerA);
        assign(shiftA, secondWorker);
        Recommendation r = recommendation(shiftA, TARGETED_PLAN_TEMPLATE.formatted(workerA.getId()));

        UUID approvalId = decideAndExtractApprovalId(r, "APPROVED", null, null);

        // Before SCRUM-288 this dispatched to both — the whole point of appliesTo is that an
        // advisory aimed at one unacclimatised worker does not instruct their whole crew.
        assertThat(actionDispatches.findByApprovalId(approvalId))
                .extracting(d -> d.getWorker().getId())
                .containsExactly(workerA.getId());
    }

    @Test
    void aMitigationWithoutAppliesToStillReachesTheWholeShift() throws Exception {
        AppUser secondWorker = user(Role.WORKER, siteA);
        assign(shiftA, workerA);
        assign(shiftA, secondWorker);
        Recommendation r = recommendation(shiftA, CODED_DRAFT_PLAN);

        UUID approvalId = decideAndExtractApprovalId(r, "APPROVED", null, null);

        // Absent means whole-shift, not "unknown" — two mitigations x two workers.
        assertThat(actionDispatches.findByApprovalId(approvalId))
                .extracting(d -> d.getWorker().getId())
                .containsExactlyInAnyOrder(workerA.getId(), workerA.getId(),
                        secondWorker.getId(), secondWorker.getId());
    }

    @Test
    void aWorkerNamedInThePlanButNoLongerOnTheShiftIsNotDispatchedTo() throws Exception {
        AppUser departedWorker = user(Role.WORKER, siteA);
        assign(shiftA, workerA);
        // departedWorker is deliberately never assigned: the plan was drafted when they were on
        // the shift, and a stored plan must not be able to dispatch to someone who has since left.
        Recommendation r = recommendation(shiftA, TARGETED_PLAN_TEMPLATE.formatted(departedWorker.getId()));

        UUID approvalId = decideAndExtractApprovalId(r, "APPROVED", null, null);

        assertThat(actionDispatches.findByApprovalId(approvalId)).isEmpty();
    }

    @Test
    void anEditedPlanCarryingAnUnknownActionCodeIsRejected() throws Exception {
        Recommendation r = recommendation(shiftA, CODED_DRAFT_PLAN);

        Map<String, Object> invented = new LinkedHashMap<>();
        invented.put("priority", "HIGH");
        invented.put("action", "Seek proper shelter immediately");
        invented.put("rationale", "Lightning within 8 km");
        invented.put("estimatedImpact", "Removes strike exposure");
        // No locale translates this, so a worker would receive "Seek shelter now" humanised into
        // English. §8.5: a plan with an unknown action code cannot be saved.
        invented.put("actionCode", "SEEK_SHELTER_NOW");

        postJson(recommendationsUrl(shiftA) + "/" + r.getId() + "/decision", supervisorAToken,
                        decisionBody("EDITED", null, List.of(invented)))
                .andExpect(status().isBadRequest());

        // Nothing was recorded: the recommendation is still waiting for a decision, so the
        // supervisor can correct the plan and decide again rather than being locked out by a 409.
        assertThat(recommendations.findById(r.getId()))
                .get()
                .extracting(Recommendation::getStatus)
                .isEqualTo(Recommendation.RecommendationStatus.PENDING_APPROVAL);
    }

    @Test
    void rejectingCreatesNoDispatches() throws Exception {
        assign(shiftA, workerA);
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        UUID approvalId = decideAndExtractApprovalId(r, "REJECTED",
                "Crew already rotated off heavy tasks this shift", null);

        assertThat(actionDispatches.findByApprovalId(approvalId)).isEmpty();
    }

    @Test
    void editingDispatchesTheEditedPlanNotTheOriginalDraft() throws Exception {
        assign(shiftA, workerA);
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        var editedPlan = List.of(Map.of(
                "priority", "MEDIUM",
                "action", "Reduce work hours to 30 min active / 10 min rest",
                "rationale", "Crew has partial acclimatisation, full 20/10 split not warranted",
                "estimatedImpact", "8-10% reduction in heat stress risk"));

        UUID approvalId = decideAndExtractApprovalId(r, "EDITED", null, editedPlan);

        List<ActionDispatch> dispatches = actionDispatches.findByApprovalId(approvalId);
        assertThat(dispatches).hasSize(1);
        assertThat(dispatches.get(0).getInstruction()).isEqualTo("Reduce work hours to 30 min active / 10 min rest");
    }

    @Test
    void approvingAShiftWithNoAssignedWorkersCreatesNoDispatchesButStillSucceeds() throws Exception {
        Recommendation r = recommendation(shiftA, DRAFT_PLAN);

        UUID approvalId = decideAndExtractApprovalId(r, "APPROVED", null, null);

        assertThat(actionDispatches.findByApprovalId(approvalId)).isEmpty();
    }
}
