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
 * and real dispatches go out, and finally conditions cross the retained WBGT emergency-stop
 * threshold. High WBGT remains pending approval and does not create an immediate dispatch --
 * but it does reach the already-APPROVED plan: conditions changing again makes an approved plan
 * just as stale as a pending one, so it is superseded too and its outstanding dispatches are
 * revoked, not left standing alongside the fresh draft.
 *
 * <p>Only {@link AgentDraftClient} is mocked (no Bedrock access in this environment) --
 * every mitigation still comes from this codebase's real deterministic-fallback path, not a
 * canned test response, the same technique {@code AgentDraftTransactionIntegrationTest} uses.
 *
 * <p>Split into one phase method per step of the story (rather than one long test method) so
 * each stays independently readable, and so a lambda asserting a thrown exception only ever
 * calls the one thing actually expected to throw -- IDs are resolved to local variables first,
 * not evaluated as method calls inside the lambda itself.
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

    /** One site, one shift, one worker, and the instant the shift was created -- threaded through every phase. */
    private record Fixture(Site site, Shift shift, AppUser supervisor, AppUser worker, Instant now) {
    }

    @Test
    @DisplayName("PLANNED shift -> ACTIVE -> band change drafts -> a second change supersedes -> "
            + "approval dispatches -> high WBGT supersedes the approved plan and revokes its dispatches")
    void theWholeChainWorksTogether() {
        when(agentDraftClient.draft(any())).thenThrow(new RuntimeException("no ml-service in this test"));

        Fixture fixture = setUpSiteShiftAndWorker();
        activateShift(fixture);

        seedFirstEvaluation(fixture);
        Recommendation firstDraft = draftOnBandChange(fixture);
        Recommendation survivingDraft = secondChangeSupersedes(fixture, firstDraft);
        Recommendation approved = supervisorApprovalDispatches(fixture, survivingDraft);
        Recommendation highWbgtPending = highWbgtSupersedesTheApprovedPlan(fixture, approved);

        cancelledDispatchesRemainVisible(fixture, approved, highWbgtPending);
    }

    /** Setup: a site, an emergency-stop policy, a shift starting 5 minutes ago, one worker. */
    private Fixture setUpSiteShiftAndWorker() {
        Site site = sites.save(new Site("Full Workflow " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
        policyVersions.save(emergencyStopPolicy(site.getId()));

        AppUser supervisor = person(site, Role.SUPERVISOR);
        AppUser worker = person(site, Role.WORKER);
        Instant now = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Shift shift = shifts.save(new Shift(site.getId(), now.minusSeconds(300), now.plusSeconds(8 * 3600)));
        shiftAssignments.save(new ShiftAssignment(shift.getId(), worker.getId(), "Rebar", Intensity.HEAVY, 2));

        assertThat(shifts.findById(shift.getId()).orElseThrow().getStatus()).isEqualTo(ShiftStatus.PLANNED);
        return new Fixture(site, shift, supervisor, worker, now);
    }

    /** Step 1 (SCRUM-441): the shift-activation scheduler's own method flips it ACTIVE. */
    private void activateShift(Fixture fixture) {
        int activatedCount = shiftService.activateDueShifts();

        assertThat(activatedCount).isGreaterThanOrEqualTo(1);
        assertThat(shifts.findById(fixture.shift().getId()).orElseThrow().getStatus()).isEqualTo(ShiftStatus.ACTIVE);
        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_ACTIVATED))
                .anyMatch(e -> fixture.shift().getId().equals(e.getTargetId()) && e.getActorId() == null);
    }

    /** Step 2 (SCRUM-291): first-ever evaluation seeds site state, drafts nothing. */
    private void seedFirstEvaluation(Fixture fixture) {
        Instant t1 = fixture.now().plusSeconds(10);
        weatherObservations.save(observation(fixture.site().getId(), new BigDecimal("31.50"), t1)); // BAND_31_TO_BELOW_32

        autoTriggerService.evaluateAllSites();

        assertThat(recommendations.findByShiftId(fixture.shift().getId())).isEmpty();
    }

    /** Step 3: a genuine band change (31.5 -> 32.5) auto-drafts, with nobody in the loop. */
    private Recommendation draftOnBandChange(Fixture fixture) {
        Instant t2 = fixture.now().plusSeconds(20);
        weatherObservations.save(observation(fixture.site().getId(), new BigDecimal("32.50"), t2)); // BAND_32_TO_BELOW_33

        autoTriggerService.evaluateAllSites();

        List<Recommendation> afterFirstDraft = recommendations.findByShiftId(fixture.shift().getId());
        assertThat(afterFirstDraft).hasSize(1);
        Recommendation firstDraft = afterFirstDraft.get(0);
        assertThat(firstDraft.getStatus()).isEqualTo(Recommendation.RecommendationStatus.PENDING_APPROVAL);
        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.RECOMMENDATION_DRAFTED))
                .anyMatch(e -> firstDraft.getId().equals(e.getTargetId()) && e.getActorId() == null);
        return firstDraft;
    }

    /**
     * Step 4: conditions change AGAIN before anyone decided -- the new draft supersedes, it
     * does not stack (the SCRUM-291 dedup guard). Also confirms a superseded recommendation
     * can never be decided on.
     */
    private Recommendation secondChangeSupersedes(Fixture fixture, Recommendation firstDraft) {
        Instant t3 = fixture.now().plusSeconds(30);
        weatherObservations.save(observation(fixture.site().getId(), new BigDecimal("30.00"), t3)); // BAND_BELOW_31

        autoTriggerService.evaluateAllSites();

        Recommendation supersededFirstDraft = recommendations.findById(firstDraft.getId()).orElseThrow();
        assertThat(supersededFirstDraft.getStatus()).isEqualTo(Recommendation.RecommendationStatus.SUPERSEDED);
        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.RECOMMENDATION_SUPERSEDED))
                .anyMatch(e -> firstDraft.getId().equals(e.getTargetId()));

        List<Recommendation> afterSupersede = recommendations.findByShiftId(fixture.shift().getId());
        assertThat(afterSupersede).hasSize(2);
        Recommendation survivingDraft = afterSupersede.stream()
                .filter(r -> r.getStatus() == Recommendation.RecommendationStatus.PENDING_APPROVAL)
                .findFirst().orElseThrow();

        assertCannotBeDecided(fixture, supersededFirstDraft);
        return survivingDraft;
    }

    /** Step 5: a supervisor approves the surviving draft -- real dispatches go out. */
    private Recommendation supervisorApprovalDispatches(Fixture fixture, Recommendation survivingDraft) {
        recommendationService.decide(fixture.site().getId(), fixture.shift().getId(), survivingDraft.getId(),
                fixture.supervisor().getId(), Approval.ApprovalDecision.APPROVED, null, null);

        Recommendation approved = recommendations.findById(survivingDraft.getId()).orElseThrow();
        assertThat(approved.getStatus()).isEqualTo(Recommendation.RecommendationStatus.APPROVED);
        assertThat(approvals.findByRecommendationId(approved.getId())).isPresent();

        List<ActionDispatch> approvedPathDispatches = actionDispatches.findByShiftId(fixture.shift().getId());
        assertThat(approvedPathDispatches).isNotEmpty();
        assertThat(approvedPathDispatches).allSatisfy(d -> assertThat(d.getApproval()).isNotNull());
        return approved;
    }

    /**
     * Step 6: high WBGT drafts an ordinary PENDING_APPROVAL plan -- the retained legacy
     * emergency-stop threshold is deliberately ignored by policy enforcement, so no immediate
     * dispatch is created. But it also reaches the already-APPROVED plan: conditions changing
     * again makes an approved plan just as stale as a pending one, so supersede now reaches it
     * too, and its outstanding (still-PENDING) dispatches are revoked rather than left standing
     * alongside the fresh draft.
     */
    private Recommendation highWbgtSupersedesTheApprovedPlan(Fixture fixture, Recommendation approved) {
        Instant t4 = fixture.now().plusSeconds(40);
        // BAND_33_AND_ABOVE, above the retained legacy threshold.
        weatherObservations.save(observation(fixture.site().getId(), new BigDecimal("34.00"), t4));

        autoTriggerService.evaluateAllSites();

        List<Recommendation> finalState = recommendations.findByShiftId(fixture.shift().getId());
        Recommendation pending = finalState.stream()
                .filter(r -> r.getStatus() == Recommendation.RecommendationStatus.PENDING_APPROVAL)
                .filter(r -> !r.getId().equals(approved.getId()))
                .findFirst().orElseThrow(() -> new AssertionError("Expected a pending high-WBGT recommendation"));

        assertThat(recommendations.findById(approved.getId()).orElseThrow().getStatus())
                .isEqualTo(Recommendation.RecommendationStatus.SUPERSEDED);
        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.RECOMMENDATION_SUPERSEDED))
                .anyMatch(e -> approved.getId().equals(e.getTargetId()));
        assertThat(approvals.findByRecommendationId(pending.getId())).isEmpty();

        List<ActionDispatch> approvedPlanDispatches = actionDispatches.findByShiftId(fixture.shift().getId());
        assertThat(approvedPlanDispatches).isNotEmpty();
        assertThat(approvedPlanDispatches).allMatch(d -> d.getRecommendation().getId().equals(approved.getId()));
        assertThat(approvedPlanDispatches)
                .allMatch(d -> d.getStatus() == ActionDispatch.ActionDispatchStatus.CANCELLED);
        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.ACTION_REVOKED)).isNotEmpty();

        return pending;
    }

    /**
     * Step 7: everything is visible through the real shift-scoped query, not just the
     * freshly-created rows -- proving the recommendation_id fix still works for the
     * now-cancelled dispatch path while a high-WBGT recommendation remains pending.
     * Also checked through the actual SCRUM-317 dashboard read path (findFirstBySiteIdAndStatus
     * -> ACTIVE shift -> findByShiftId).
     */
    private void cancelledDispatchesRemainVisible(Fixture fixture, Recommendation approved,
                                                   Recommendation highWbgtPending) {
        List<ActionDispatch> allDispatchesForShift = actionDispatches.findByShiftId(fixture.shift().getId());
        assertThat(allDispatchesForShift.stream().map(ActionDispatch::getRecommendation).map(Recommendation::getId))
                .containsOnly(approved.getId());
        assertThat(recommendations.findById(highWbgtPending.getId()).orElseThrow().getStatus())
                .isEqualTo(Recommendation.RecommendationStatus.PENDING_APPROVAL);
        assertThat(allDispatchesForShift).allSatisfy(d -> assertThat(d.getApproval()).isNotNull());

        List<ActionDispatch> viaSiteSnapshot = actionStatusSnapshotService.getDispatchesForSite(fixture.site().getId());
        assertThat(viaSiteSnapshot).hasSameSizeAs(allDispatchesForShift);
    }

    /**
     * IDs are resolved to local variables before the lambda, rather than calling {@code
     * .getId()} inside it, so the assertion has exactly one call that can throw -- {@code
     * decide} itself -- not several.
     */
    private void assertCannotBeDecided(Fixture fixture, Recommendation recommendation) {
        UUID siteId = fixture.site().getId();
        UUID shiftId = fixture.shift().getId();
        UUID recommendationId = recommendation.getId();
        UUID supervisorId = fixture.supervisor().getId();

        assertThatThrownBy(() -> recommendationService.decide(siteId, shiftId, recommendationId, supervisorId,
                Approval.ApprovalDecision.APPROVED, null, null))
                .isInstanceOf(RuntimeException.class);
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
