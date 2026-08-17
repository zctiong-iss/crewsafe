package com.crewsafe.operation.api;

import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.mitigation.domain.MitigationSuggestion;
import com.crewsafe.operation.domain.Approval;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.domain.RecommendationEvidence;
import com.crewsafe.operation.service.AgentDraftService;
import com.crewsafe.operation.service.RecommendationService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Recommendation endpoints (SCRUM-119): a supervisor reads a shift's AI-drafted
 * recommendations and records an approve/edit/reject decision on one. Reading is also open
 * to a safety manager, so they can see what the supervisor decided and, for an EDITED
 * decision, what changed from the original draft.
 *
 * <p>Site-scoped the same way {@link com.crewsafe.shift.api.ShiftController} is:
 * {@code @PreAuthorize("@siteAccess.canAccess(#siteId)")} on every method. Deciding is
 * additionally role-gated to SUPERVISOR/ADMIN — a safety manager may read a decision but not
 * make one; that is the supervisor's call to record, per SCRUM-119.
 *
 * @author Abu Bakar
 */
@RestController
@RequestMapping("/api/v1/sites/{siteId}/shifts/{shiftId}/recommendations")
@RequiredArgsConstructor
@Slf4j
public class RecommendationController {

    private final RecommendationService recommendationService;
    private final AgentDraftService agentDraftService;
    /** Names the workers a plan refers to; see {@link #workersNamedBy}. */
    private final AppUserRepository users;

    /**
     * {@code approverName} exists because {@code approverId} alone is unresolvable by any
     * client.
     *
     * <p>The obvious lookup is {@code GET /sites/{siteId}/workers}, and it cannot work: that
     * endpoint returns {@code Role.WORKER} only, while an approver is by definition a
     * SUPERVISOR. So a client holding an approver id had no list it could ever find the name
     * in, and the oversight screen fell back to rendering the raw UUID — a 36-character string
     * with no spaces, which is meaningless to a manager and cannot line-wrap.
     *
     * <p>Costs nothing: {@link Approval#getApprover()} is already loaded to read its id.
     */
    public record ApprovalResponse(UUID id, UUID approverId, String approverName, String decision,
                                    String reason, List<MitigationSuggestion> editedMitigations,
                                    Instant decidedAt) {
        static ApprovalResponse from(Approval approval, List<MitigationSuggestion> editedMitigations) {
            return new ApprovalResponse(approval.getId(), approval.getApprover().getId(),
                    approval.getApprover().getDisplayName(),
                    approval.getDecision().name(), approval.getReason(), editedMitigations, approval.getDecidedAt());
        }
    }

    /** A worker this plan names, so a client never has to assemble the name itself. */
    public record PlanWorker(UUID id, String displayName) {
    }

    /**
     * {@code evidence} and {@code modelVersion} were added by SCRUM-359, satisfying §12.2's
     * requirement that a recommendation always surfaces its data age, model version and policy
     * version. Both are additive and both are null on recommendations drafted before they
     * existed, so existing consumers are unaffected and new ones must render null as "not
     * recorded" rather than substituting current readings.
     *
     * <p>{@code workers} names everyone the plan's mitigations refer to — see
     * {@link #workersNamedBy} for why the server resolves that rather than the client.
     */
    public record RecommendationResponse(UUID id, UUID shiftId, String policyVersion, String status,
                                          String rationale, Instant createdAt,
                                          List<MitigationSuggestion> mitigations, ApprovalResponse approval,
                                          RecommendationEvidence evidence, String modelVersion,
                                          List<PlanWorker> workers) {
        static RecommendationResponse from(Recommendation recommendation, List<MitigationSuggestion> mitigations,
                                            ApprovalResponse approval, RecommendationEvidence evidence,
                                            List<PlanWorker> workers) {
            return new RecommendationResponse(recommendation.getId(), recommendation.getShiftId(),
                    recommendation.getPolicyVersion(), recommendation.getStatus().name(),
                    recommendation.getRationale(), recommendation.getCreatedAt(), mitigations, approval,
                    evidence, recommendation.getModelVersion(), workers);
        }
    }

    public record RecommendationDecisionRequest(
            @NotNull Approval.ApprovalDecision decision,
            String reason,
            List<MitigationSuggestion> editedPlan) {
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<List<RecommendationResponse>> listRecommendations(
            @PathVariable UUID siteId, @PathVariable UUID shiftId) {

        return recommendationService.listForShift(siteId, shiftId)
                .map(list -> list.stream().map(this::toResponse).toList())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/{recommendationId}")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<RecommendationResponse> getRecommendation(
            @PathVariable UUID siteId, @PathVariable UUID shiftId, @PathVariable UUID recommendationId) {

        return recommendationService.getRecommendation(siteId, shiftId, recommendationId)
                .map(this::toResponse)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/{recommendationId}/decision")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<RecommendationResponse> decide(
            @PathVariable UUID siteId, @PathVariable UUID shiftId, @PathVariable UUID recommendationId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @Valid @RequestBody RecommendationDecisionRequest request) {

        return recommendationService.decide(siteId, shiftId, recommendationId, principal.getId(),
                        request.decision(), request.reason(), request.editedPlan())
                .flatMap(approval -> recommendationService.getRecommendation(siteId, shiftId, recommendationId)
                        .map(this::toResponse))
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * Drafts a new recommendation for a shift (SCRUM-289, completing US-08).
     *
     * <p>Synchronous, and that is a considered choice for the MVP rather than an omission. The
     * call takes roughly 10–20s against the selected model, which a supervisor-initiated action
     * can carry behind a loading state; making it asynchronous would require a notification path
     * to tell them it finished, and mobile has none — it loads recommendations on mount and
     * pull-to-refresh only. Deferred rather than half-built.
     *
     * <p>Restricted to SUPERVISOR/ADMIN, matching {@code /decision}: drafting costs a billed
     * model call and creates something a supervisor must then act on, so it belongs to the same
     * people who can decide it. A safety manager may read the result but not trigger one.
     */
    @PostMapping("/generate")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<RecommendationResponse> generate(
            @PathVariable UUID siteId, @PathVariable UUID shiftId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        return agentDraftService.generate(siteId, shiftId, principal.getId())
                .map(this::toResponse)
                .map(response -> ResponseEntity.status(HttpStatus.CREATED).body(response))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    private RecommendationResponse toResponse(Recommendation recommendation) {
        List<MitigationSuggestion> mitigations = recommendationService.draftMitigations(recommendation);
        ApprovalResponse approval = recommendationService.approvalFor(recommendation.getId())
                .map(a -> ApprovalResponse.from(a, recommendationService.editedMitigations(a)))
                .orElse(null);
        return RecommendationResponse.from(recommendation, mitigations, approval,
                recommendationService.evidenceFor(recommendation),
                workersNamedBy(mitigations, approval));
    }

    /**
     * Names every worker the plan mentions, resolved now rather than stored.
     *
     * <h2>Why the server does this</h2>
     *
     * A mitigation carries worker ids, and the client used to turn them into names against the
     * list held by {@code shiftsSlice}. That list belongs to whichever site the shifts screen
     * last loaded, and nothing on the recommendation screen loads it — so a supervisor saw names
     * only because they had passed through a screen that happened to populate it, and a safety
     * manager, who has no shifts tab and may arrive straight from oversight, saw every worker as
     * "no longer on this site". Present workers, reported as departed, on a safety record.
     *
     * <p>Looked up by id straight from {@code app_user}, which also fixes the case the client
     * never could: {@code GET /workers} returns ACTIVE members of one site, so a worker who has
     * since left was genuinely unresolvable there. Here they still have a name.
     *
     * <h2>Why resolved rather than stored</h2>
     *
     * The obvious alternative is putting names into {@code MitigationSuggestion}, which is
     * serialised into {@code draft_plan}. That would freeze a display name into a persisted
     * record at draft time, so a later correction to someone's name would never reach a plan
     * already written. Ids are the stable thing; names are a view of them.
     *
     * <p>Includes the edited plan's workers as well as the draft's — an EDITED approval can
     * name someone the original draft did not, and that screen renders both.
     */
    private List<PlanWorker> workersNamedBy(List<MitigationSuggestion> mitigations,
                                             ApprovalResponse approval) {
        Set<UUID> ids = new LinkedHashSet<>();
        collectWorkerIds(mitigations, ids);
        if (approval != null) {
            collectWorkerIds(approval.editedMitigations(), ids);
        }
        if (ids.isEmpty()) {
            return List.of();
        }
        return users.findAllById(ids).stream()
                .map(user -> new PlanWorker(user.getId(), user.getDisplayName()))
                .toList();
    }

    /**
     * A null or absent {@code appliesTo} means the whole shift rather than nobody, so it
     * contributes no ids — the screen states that in words instead of listing names.
     */
    private static void collectWorkerIds(List<MitigationSuggestion> mitigations, Set<UUID> into) {
        if (mitigations == null) {
            return;
        }
        for (MitigationSuggestion mitigation : mitigations) {
            if (mitigation == null || mitigation.appliesTo() == null) {
                continue;
            }
            for (String workerId : mitigation.appliesTo()) {
                try {
                    into.add(UUID.fromString(workerId));
                } catch (IllegalArgumentException e) {
                    // A plan drafted with a non-UUID in appliesTo. Skipping it loses one name;
                    // letting it throw would lose the whole recommendation.
                    log.warn("recommendation_worker_id_unparseable");
                }
            }
        }
    }
}
