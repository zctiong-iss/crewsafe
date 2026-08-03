package com.crewsafe.operation.service;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.mitigation.domain.MitigationSuggestion;
import com.crewsafe.operation.domain.Approval;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.repository.ApprovalRepository;
import com.crewsafe.operation.repository.RecommendationRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Read a shift's AI-drafted recommendations and record a supervisor's approve/edit/reject
 * decision on one (SCRUM-119) — the missing service layer over the {@code Recommendation} /
 * {@code Approval} entities, which until now existed with no code reading or writing them.
 *
 * <p>Creating a {@code Recommendation} itself (the agent drafting a plan, SCRUM-118) is out of
 * scope here — this class only consumes recommendations that already exist, the same way
 * {@code ActionDispatchService} only consumes approvals that already exist.
 *
 * @author Abu Bakar
 */
@Service
@RequiredArgsConstructor
public class RecommendationService {

    private final RecommendationRepository recommendations;
    private final ApprovalRepository approvals;
    private final ShiftRepository shifts;
    private final AppUserRepository users;
    private final AuditService audit;
    private final ObjectMapper objectMapper;

    /** Empty when no shift with this id exists under this site — the caller renders 404. */
    public Optional<List<Recommendation>> listForShift(UUID siteId, UUID shiftId) {
        if (shifts.findByIdAndSiteId(shiftId, siteId).isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(recommendations.findByShiftId(shiftId));
    }

    /**
     * Empty when no shift with this id exists under this site, or no recommendation with this
     * id exists on that shift — the caller renders 404 either way.
     */
    public Optional<Recommendation> getRecommendation(UUID siteId, UUID shiftId, UUID recommendationId) {
        if (shifts.findByIdAndSiteId(shiftId, siteId).isEmpty()) {
            return Optional.empty();
        }
        return recommendations.findByIdAndShiftId(recommendationId, shiftId);
    }

    public Optional<Approval> approvalFor(UUID recommendationId) {
        return approvals.findByRecommendationId(recommendationId);
    }

    /** The mitigations a recommendation's draft plan holds. Empty when there is none stored. */
    public List<MitigationSuggestion> draftMitigations(Recommendation recommendation) {
        return parsePlan(recommendation.getDraftPlan());
    }

    /** The mitigations an approval's edited plan holds. Empty when the decision made no edits. */
    public List<MitigationSuggestion> editedMitigations(Approval approval) {
        return parsePlan(approval.getEditedPlan());
    }

    private List<MitigationSuggestion> parsePlan(String plan) {
        if (plan == null || plan.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(plan, MitigationSuggestion.Batch.class).mitigations();
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Stored plan is not valid JSON", e);
        }
    }

    /**
     * Records a supervisor's decision on a recommendation. {@code editedPlan} is required
     * (and non-empty) only when {@code decision} is {@code EDITED}; {@code reason} is required
     * only when it is {@code REJECTED} — both checked here, not by request-shape validation
     * alone, since which fields are required depends on the value of another field.
     *
     * <p>A recommendation can be decided on exactly once: {@code approval.recommendation_id}
     * is unique, matching the domain rule that a decision is a record of what happened, not
     * something correctable via this endpoint. A second attempt is a 409, not a silent
     * overwrite.
     *
     * <p>Empty when no shift with this id exists under this site, or no recommendation with
     * this id exists on that shift — the caller renders 404 either way.
     */
    @Transactional
    public Optional<Approval> decide(UUID siteId, UUID shiftId, UUID recommendationId, UUID actorId,
                                      Approval.ApprovalDecision decision, String reason,
                                      List<MitigationSuggestion> editedPlan) {
        if (shifts.findByIdAndSiteId(shiftId, siteId).isEmpty()) {
            return Optional.empty();
        }

        return recommendations.findByIdAndShiftId(recommendationId, shiftId).map(recommendation -> {
            if (approvals.findByRecommendationId(recommendationId).isPresent()) {
                throw new ConflictException("Recommendation " + recommendationId + " already has a decision");
            }

            if (decision == Approval.ApprovalDecision.EDITED && (editedPlan == null || editedPlan.isEmpty())) {
                throw new BadRequestException("editedPlan is required when decision is EDITED");
            }
            if (decision == Approval.ApprovalDecision.REJECTED && (reason == null || reason.isBlank())) {
                throw new BadRequestException("reason is required when decision is REJECTED");
            }

            AppUser approver = users.findById(actorId)
                    .orElseThrow(() -> new IllegalStateException("Authenticated user not found: " + actorId));

            Approval approval = Approval.builder()
                    .id(UUID.randomUUID())
                    .recommendation(recommendation)
                    .approver(approver)
                    .decision(decision)
                    .reason(reason)
                    .editedPlan(decision == Approval.ApprovalDecision.EDITED ? serializePlan(editedPlan) : null)
                    .decidedAt(Instant.now())
                    .build();
            Approval saved = approvals.save(approval);

            recommendation.setStatus(decision == Approval.ApprovalDecision.REJECTED
                    ? Recommendation.RecommendationStatus.REJECTED
                    : Recommendation.RecommendationStatus.APPROVED);
            recommendations.save(recommendation);

            String eventType = switch (decision) {
                case APPROVED -> AuditEventType.RECOMMENDATION_APPROVED;
                case REJECTED -> AuditEventType.RECOMMENDATION_REJECTED;
                case EDITED -> AuditEventType.RECOMMENDATION_EDITED;
            };
            UUID savedId = saved.getId();
            afterCommit(() -> audit.record(actorId, eventType, "RECOMMENDATION", recommendationId,
                    "Recommendation " + decision.name().toLowerCase() + " (approval " + savedId + ")"));

            return saved;
        });
    }

    private String serializePlan(List<MitigationSuggestion> plan) {
        try {
            return objectMapper.writeValueAsString(new MitigationSuggestion.Batch(plan));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize edited plan", e);
        }
    }

    /**
     * {@link AuditService#record} runs in {@code REQUIRES_NEW}, so an inline call would commit
     * the audit row immediately, independent of the caller's own transaction. Deferred until
     * commit, same pattern (and same reason) as {@code ShiftService#afterCommit}.
     */
    private void afterCommit(Runnable action) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                action.run();
            }
        });
    }
}
