package com.crewsafe.operation.api;

import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.mitigation.domain.MitigationSuggestion;
import com.crewsafe.operation.domain.Approval;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.service.RecommendationService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
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
import java.util.List;
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
public class RecommendationController {

    private final RecommendationService recommendationService;

    public record ApprovalResponse(UUID id, UUID approverId, String decision, String reason,
                                    List<MitigationSuggestion> editedMitigations, Instant decidedAt) {
        static ApprovalResponse from(Approval approval, List<MitigationSuggestion> editedMitigations) {
            return new ApprovalResponse(approval.getId(), approval.getApprover().getId(),
                    approval.getDecision().name(), approval.getReason(), editedMitigations, approval.getDecidedAt());
        }
    }

    public record RecommendationResponse(UUID id, UUID shiftId, String policyVersion, String status,
                                          String rationale, Instant createdAt,
                                          List<MitigationSuggestion> mitigations, ApprovalResponse approval) {
        static RecommendationResponse from(Recommendation recommendation, List<MitigationSuggestion> mitigations,
                                            ApprovalResponse approval) {
            return new RecommendationResponse(recommendation.getId(), recommendation.getShiftId(),
                    recommendation.getPolicyVersion(), recommendation.getStatus().name(),
                    recommendation.getRationale(), recommendation.getCreatedAt(), mitigations, approval);
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

    private RecommendationResponse toResponse(Recommendation recommendation) {
        List<MitigationSuggestion> mitigations = recommendationService.draftMitigations(recommendation);
        ApprovalResponse approval = recommendationService.approvalFor(recommendation.getId())
                .map(a -> ApprovalResponse.from(a, recommendationService.editedMitigations(a)))
                .orElse(null);
        return RecommendationResponse.from(recommendation, mitigations, approval);
    }
}
