package com.crewsafe.operation;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.common.audit.AuditEventRepository;
import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.mitigation.ai.bedrock.AgentDraftClient;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.domain.Approval;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.repository.ActionDispatchRepository;
import com.crewsafe.operation.repository.ApprovalRepository;
import com.crewsafe.operation.repository.RecommendationRepository;
import com.crewsafe.operation.service.ActionStatusSnapshotService;
import com.crewsafe.operation.service.RecommendationAutoTriggerService;
import com.crewsafe.operation.service.RecommendationService;
import com.crewsafe.policy.domain.PolicyVersion;
import com.crewsafe.policy.domain.PolicyVersionStatus;
import com.crewsafe.policy.repository.PolicyVersionRepository;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.shift.service.ShiftService;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;

import java.lang.reflect.Constructor;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * The whole SCRUM-441 / SCRUM-291 / SCRUM-440 story, end to end, against real Postgres and
 * real Spring beans -- not a demo, a regression test for the three tickets working together
 * as one system rather than three independently-passing pieces.
 *
 * <p>Walks exactly the sequence a real deployment would hit: a shift sits PLANNED, the
 * SCRUM-441 scheduler's own method flips it ACTIVE, conditions drift into a new WBGT band and
 * the SCRUM-291 auto-trigger drafts a recommendation with no supervisor involved, a second
 * drift before anyone decides supersedes it (dedup), a supervisor approves the surviving one
 * and real dispatches go out, and finally conditions cross the WBGT-max threshold and SCRUM-440
 * takes over completely -- no approval step, dispatches fire immediately, and the resulting
 * recommendation can never be decided on afterward.
 *
 * <p>Only {@link AgentDraftClient} is mocked (no Bedrock access in this environment) --
 * every mitigation still comes from this codebase's real deterministic-fallback path, not a
 * canned test response, the same technique {@code AgentDraftTransactionIntegrationTest} uses.
 *
 * @author Abu Bakar
 */
class FullAgentWorkflowIntegrationTest extends AbstractIntegrationTest {

    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private AppUserRepository users;
    @Autowired private ShiftRepository shifts;
    @Autowired private ShiftAssignmentRepository shiftAssignments;
    @Autowired private ShiftService shiftService;
    @Autowired private WeatherObservationRepository weatherObservations;
    @Autowired private PolicyVersionRepository policyVersions;
    @Autowired private RecommendationRepository recommendations;
    @Autowired private ApprovalRepository approvals;
    @Autowired private ActionDispatchRepository actionDispatches;
    @Autowired private AuditEventRepository auditEvents;
    @Autowired private RecommendationAutoTriggerService autoTriggerService;
    @Autowired private RecommendationService recommendationService;
    @Autowired private ActionStatusSnapshotService actionStatusSnapshotService;

    @MockitoBean private AgentDraftClient agentDraftClient;

    @Test
    @DisplayName("PLANNED shift -> ACTIVE -> band change drafts -> a second change supersedes -> "
            + "approval dispatches -> a WBGT-max breach bypasses approval entirely")
    void theWholeChainWorksTogether() {
        when(agentDraftClient.draft(any())).thenThrow(new RuntimeException("no ml-service in this test"));

        // ── Setup: a site, an emergency-stop policy, a shift starting 5 minutes ago, one worker ──
        Site site = sites.save(new Site("Full Workflow " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
        policyVersions.save(emergencyStopPolicy(site.getId()));

        AppUser supervisor = person(site, Role.SUPERVISOR);
        AppUser worker = person(site, Role.WORKER);
        Instant now = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Shift shift = shifts.save(new Shift(site.getId(), now.minusSeconds(300), now.plusSeconds(8 * 3600)));
        shiftAssignments.save(new ShiftAssignment(shift.getId(), worker.getId(), "Rebar", Intensity.HEAVY, 2));

        assertThat(shifts.findById(shift.getId()).orElseThrow().getStatus()).isEqualTo(ShiftStatus.PLANNED);

        // ── Step 1 (SCRUM-441): the shift-activation scheduler's own method flips it ACTIVE ──
        int activatedCount = shiftService.activateDueShifts();
        assertThat(activatedCount).isGreaterThanOrEqualTo(1);
        assertThat(shifts.findById(shift.getId()).orElseThrow().getStatus()).isEqualTo(ShiftStatus.ACTIVE);
        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_ACTIVATED))
                .anyMatch(e -> shift.getId().equals(e.getTargetId()) && e.getActorId() == null);

        // ── Step 2 (SCRUM-291): first-ever evaluation seeds site state, drafts nothing ──
        Instant t1 = now.plusSeconds(10);
        weatherObservations.save(observation(site.getId(), new BigDecimal("31.50"), t1)); // BAND_31_TO_BELOW_32
        autoTriggerService.evaluateAllSites();
        assertThat(recommendations.findByShiftId(shift.getId())).isEmpty();

        // ── Step 3: a genuine band change (31.5 -> 32.5) auto-drafts, with nobody in the loop ──
        Instant t2 = now.plusSeconds(20);
        weatherObservations.save(observation(site.getId(), new BigDecimal("32.50"), t2)); // BAND_32_TO_BELOW_33
        autoTriggerService.evaluateAllSites();

        List<Recommendation> afterFirstDraft = recommendations.findByShiftId(shift.getId());
        assertThat(afterFirstDraft).hasSize(1);
        Recommendation firstDraft = afterFirstDraft.get(0);
        assertThat(firstDraft.getStatus()).isEqualTo(Recommendation.RecommendationStatus.PENDING_APPROVAL);
        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.RECOMMENDATION_DRAFTED))
                .anyMatch(e -> firstDraft.getId().equals(e.getTargetId()) && e.getActorId() == null);

        // ── Step 4: conditions change AGAIN before anyone decided -- the new draft supersedes,
        //    it does not stack (the SCRUM-291 dedup guard) ──
        Instant t3 = now.plusSeconds(30);
        weatherObservations.save(observation(site.getId(), new BigDecimal("30.00"), t3)); // BAND_BELOW_31
        autoTriggerService.evaluateAllSites();

        Recommendation supersededFirstDraft = recommendations.findById(firstDraft.getId()).orElseThrow();
        assertThat(supersededFirstDraft.getStatus()).isEqualTo(Recommendation.RecommendationStatus.SUPERSEDED);
        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.RECOMMENDATION_SUPERSEDED))
                .anyMatch(e -> firstDraft.getId().equals(e.getTargetId()));

        List<Recommendation> afterSupersede = recommendations.findByShiftId(shift.getId());
        assertThat(afterSupersede).hasSize(2);
        Recommendation survivingDraft = afterSupersede.stream()
                .filter(r -> r.getStatus() == Recommendation.RecommendationStatus.PENDING_APPROVAL)
                .findFirst().orElseThrow();

        // A superseded recommendation can never be decided on.
        assertThatThrownBy(() -> recommendationService.decide(site.getId(), shift.getId(),
                firstDraft.getId(), supervisor.getId(), Approval.ApprovalDecision.APPROVED, null, null))
                .isInstanceOf(RuntimeException.class);

        // ── Step 5: a supervisor approves the surviving draft -- real dispatches go out ──
        recommendationService.decide(site.getId(), shift.getId(), survivingDraft.getId(), supervisor.getId(),
                Approval.ApprovalDecision.APPROVED, null, null);

        Recommendation approved = recommendations.findById(survivingDraft.getId()).orElseThrow();
        assertThat(approved.getStatus()).isEqualTo(Recommendation.RecommendationStatus.APPROVED);
        assertThat(approvals.findByRecommendationId(approved.getId())).isPresent();

        List<ActionDispatch> approvedPathDispatches = actionDispatches.findByShiftId(shift.getId());
        assertThat(approvedPathDispatches).isNotEmpty();
        assertThat(approvedPathDispatches).allSatisfy(d -> assertThat(d.getApproval()).isNotNull());

        // ── Step 6 (SCRUM-440): a WBGT-max breach -- no approval step at all, dispatched immediately ──
        Instant t4 = now.plusSeconds(40);
        weatherObservations.save(observation(site.getId(), new BigDecimal("34.00"), t4)); // BAND_33_AND_ABOVE, breaches 33.0
        autoTriggerService.evaluateAllSites();

        List<Recommendation> finalState = recommendations.findByShiftId(shift.getId());
        Recommendation autoDispatched = finalState.stream()
                .filter(r -> r.getStatus() == Recommendation.RecommendationStatus.AUTO_DISPATCHED)
                .findFirst().orElseThrow(() -> new AssertionError("Expected an AUTO_DISPATCHED recommendation"));

        // The already-APPROVED recommendation from step 5 is untouched -- supersede only ever
        // targets an open PENDING_APPROVAL row, never one already decided.
        assertThat(recommendations.findById(approved.getId()).orElseThrow().getStatus())
                .isEqualTo(Recommendation.RecommendationStatus.APPROVED);

        assertThat(approvals.findByRecommendationId(autoDispatched.getId())).isEmpty();
        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.RECOMMENDATION_AUTO_DISPATCHED))
                .anyMatch(e -> autoDispatched.getId().equals(e.getTargetId()));

        assertThatThrownBy(() -> recommendationService.decide(site.getId(), shift.getId(),
                autoDispatched.getId(), supervisor.getId(), Approval.ApprovalDecision.APPROVED, null, null))
                .isInstanceOf(RuntimeException.class);

        // ── Step 7: everything is visible through the real shift-scoped query, not just the ──
        //    freshly-created rows -- proving the recommendation_id fix didn't just work for
        //    auto-dispatched rows in isolation, it works for a shift carrying BOTH kinds at once.
        List<ActionDispatch> allDispatchesForShift = actionDispatches.findByShiftId(shift.getId());
        assertThat(allDispatchesForShift.stream().map(ActionDispatch::getRecommendation).map(Recommendation::getId))
                .contains(approved.getId(), autoDispatched.getId());
        assertThat(allDispatchesForShift.stream().filter(d -> d.getApproval() == null))
                .isNotEmpty()
                .allSatisfy(d -> assertThat(d.getRecommendation().getId()).isEqualTo(autoDispatched.getId()));
        assertThat(allDispatchesForShift.stream().map(ActionDispatch::getActionCode)).contains("STOP_WORK");

        // Same data, through the actual SCRUM-317 dashboard read path (findFirstBySiteIdAndStatus
        // -> ACTIVE shift -> findByShiftId) -- the exact path the pre-existing implicit-inner-join
        // bug would have silently emptied for the auto-dispatched half.
        List<ActionDispatch> viaSiteSnapshot = actionStatusSnapshotService.getDispatchesForSite(site.getId());
        assertThat(viaSiteSnapshot).hasSameSizeAs(allDispatchesForShift);
    }

    private AppUser person(Site site, Role role) {
        String username = "full-workflow-" + role + "-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), "Full Workflow " + role, role));
        memberships.save(new SiteMembership(created.getId(), site.getId()));
        return created;
    }

    private PolicyVersion emergencyStopPolicy(UUID siteId) {
        BigDecimal t = new BigDecimal("25.0");
        return PolicyVersion.builder()
                .id(UUID.randomUUID())
                .siteId(siteId)
                .versionLabel("FULLFLOW-" + UUID.randomUUID())
                .source("Test fixture")
                .effectiveDate(LocalDate.now())
                .status(PolicyVersionStatus.ACTIVE)
                .wbgtThresholdUnacclimatisedLight(t)
                .wbgtThresholdUnacclimatisedModerate(t)
                .wbgtThresholdUnacclimatisedHeavy(t)
                .wbgtThresholdPartialLight(t)
                .wbgtThresholdPartialModerate(t)
                .wbgtThresholdPartialHeavy(t)
                .wbgtThresholdFullLight(t)
                .wbgtThresholdFullModerate(t)
                .wbgtThresholdFullHeavy(t)
                .wbgtEmergencyStop(new BigDecimal("33.0"))
                .build();
    }

    /** {@link WeatherObservation} exposes only a protected no-arg constructor by design. */
    private static WeatherObservation observation(UUID siteId, BigDecimal wbgt, Instant observedAt) {
        try {
            Constructor<WeatherObservation> constructor = WeatherObservation.class.getDeclaredConstructor();
            constructor.setAccessible(true);
            WeatherObservation observation = constructor.newInstance();
            ReflectionTestUtils.setField(observation, "id", UUID.randomUUID());
            ReflectionTestUtils.setField(observation, "siteId", siteId);
            ReflectionTestUtils.setField(observation, "wbgt", wbgt);
            ReflectionTestUtils.setField(observation, "observedAt", observedAt);
            ReflectionTestUtils.setField(observation, "ingestedAt", observedAt);
            ReflectionTestUtils.setField(observation, "source", WeatherSource.NEA);
            ReflectionTestUtils.setField(observation, "qualityStatus", WeatherQualityStatus.LIVE);
            ReflectionTestUtils.setField(observation, "stationId", "S50");
            return observation;
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }
}
