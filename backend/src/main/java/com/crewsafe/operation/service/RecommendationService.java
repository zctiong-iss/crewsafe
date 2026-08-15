package com.crewsafe.operation.service;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.mitigation.domain.ActionCatalogue;
import com.crewsafe.mitigation.domain.MitigationSuggestion;
import com.crewsafe.operation.domain.Approval;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.domain.RecommendationEvidence;
import com.crewsafe.operation.repository.ApprovalRepository;
import com.crewsafe.operation.repository.RecommendationRepository;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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
@Slf4j
public class RecommendationService {

    /**
     * Fallback {@code actionCode} for a mitigation that carries none of its own (SCRUM-193).
     *
     * <p>Only reached by plans drafted before SCRUM-119 added {@link MitigationSuggestion
     * #actionCode()}. It is a placeholder in the literal sense — no locale has a translation for
     * it, so the mobile app humanises it into English for every worker regardless of their
     * language. That is why a mitigation that <em>does</em> carry a code now dispatches under it
     * instead; see {@link #fanOutDispatches}.
     */
    private static final String AI_MITIGATION_ACTION_CODE = "AI_RECOMMENDED_ACTION";

    private final RecommendationRepository recommendations;
    private final ApprovalRepository approvals;
    private final ShiftRepository shifts;
    private final ShiftAssignmentRepository shiftAssignments;
    private final AppUserRepository users;
    private final AuditService audit;
    private final ActionDispatchService actionDispatchService;
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

    /**
     * The conditions this recommendation was drafted under (SCRUM-359). Null on rows drafted
     * before the evidence block existed — clients render that as "not recorded".
     *
     * <p>Unparseable JSON also yields null rather than throwing, unlike {@link #parsePlan}. The
     * distinction is deliberate: a corrupt plan makes a recommendation undecidable and must be
     * loud, whereas corrupt evidence costs an explanatory panel. Failing a supervisor's whole
     * recommendation list because one row's evidence will not deserialise would trade a small
     * loss for a total one.
     */
    public RecommendationEvidence evidenceFor(Recommendation recommendation) {
        String evidence = recommendation.getEvidence();
        if (evidence == null || evidence.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(evidence, RecommendationEvidence.class);
        } catch (JsonProcessingException e) {
            log.warn("recommendation_evidence_unreadable recommendation_id={}", recommendation.getId());
            return null;
        }
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
            if (decision == Approval.ApprovalDecision.EDITED) {
                assertActionCodesAreKnown(editedPlan);
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

            if (decision != Approval.ApprovalDecision.REJECTED) {
                List<MitigationSuggestion> finalMitigations = decision == Approval.ApprovalDecision.EDITED
                        ? editedPlan
                        : parsePlan(recommendation.getDraftPlan());
                afterCommit(() -> fanOutDispatches(shiftId, saved, finalMitigations, approver));
            }

            return saved;
        });
    }

    /**
     * Creates one {@link com.crewsafe.operation.domain.ActionDispatch} per worker currently
     * assigned to this shift, per mitigation in the plan that was actually approved (SCRUM-193)
     * — the missing link between a recorded decision and a worker seeing anything in their
     * pending-dispatch inbox. Before this, {@code POST /api/action-dispatch} had to be called
     * by hand, once per worker, for every decision.
     *
     * <p>Runs after the decision itself has committed (called from {@code afterCommit}, same as
     * the audit write): a dispatch failing to create for one worker must never undo a
     * supervisor's already-recorded decision on the recommendation.
     *
     * <p><strong>Per-worker targeting (SCRUM-288, closing SCRUM-243).</strong> A mitigation
     * carrying {@code appliesTo} is dispatched only to the workers it names, intersected with
     * the shift's current assignments — a plan drafted before someone left the shift must not
     * dispatch to them, and a worker id not on this shift is ignored rather than trusted. A
     * mitigation with no {@code appliesTo} (null or empty) still goes to every worker on the
     * shift: absent means whole-shift, which is both the pre-SCRUM-288 behaviour for old plans
     * and the documented convention for new ones. A shift with no assignments dispatches
     * nothing, and that is not an error.
     *
     * <p><strong>The action code is the mitigation's own where it has one (SCRUM-119).</strong>
     * Until now every AI-sourced dispatch went out under {@link #AI_MITIGATION_ACTION_CODE},
     * which no locale translates — so a Tamil-speaking worker received "Ai recommended action"
     * in English, and every mitigation on a plan rendered identically in their inbox. Mapping
     * through {@link ActionCatalogue} makes each dispatch say what it actually is, in the
     * worker's own language, using keys the app already ships.
     */
    private void fanOutDispatches(UUID shiftId, Approval approval, List<MitigationSuggestion> mitigations,
                                   AppUser actor) {
        if (mitigations.isEmpty()) {
            return;
        }

        CrewSafeUserPrincipal actingPrincipal = new CrewSafeUserPrincipal(actor);
        List<UUID> shiftWorkerIds = shiftAssignments.findByShiftId(shiftId).stream()
                .map(ShiftAssignment::getWorkerId)
                .distinct()
                .toList();

        for (MitigationSuggestion mitigation : mitigations) {
            String dispatchCode = ActionCatalogue.toDispatchCode(mitigation.actionCode())
                    .orElse(AI_MITIGATION_ACTION_CODE);

            for (UUID workerId : targetsFor(mitigation, shiftWorkerIds)) {
                actionDispatchService.dispatchAction(approval.getId(), workerId, dispatchCode,
                        mitigation.action(), actingPrincipal);
            }
        }
    }

    /**
     * Which of the shift's workers this mitigation actually reaches. Absent or empty
     * {@code appliesTo} means the whole shift; otherwise the named workers, intersected with
     * the shift so a stale or unrecognised id in a stored plan can never dispatch to someone
     * who is not on it. An unparseable id is skipped rather than failing the whole fan-out —
     * losing one worker's dispatch is bad, losing the entire crew's is worse.
     */
    private List<UUID> targetsFor(MitigationSuggestion mitigation, List<UUID> shiftWorkerIds) {
        List<String> appliesTo = mitigation.appliesTo();
        if (appliesTo == null || appliesTo.isEmpty()) {
            return shiftWorkerIds;
        }
        return appliesTo.stream()
                .map(RecommendationService::parseUuidOrNull)
                .filter(java.util.Objects::nonNull)
                .filter(shiftWorkerIds::contains)
                .distinct()
                .toList();
    }

    private static UUID parseUuidOrNull(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * Refuses an edited plan carrying an action code no client can render (SCRUM-119).
     *
     * <p>The supervisor's app only offers codes from the draft, so this is not defending against
     * that app — it is the server-side half of §8.5, and it holds for every client. A code outside
     * {@link ActionCatalogue} has no translation in any locale, so approving one would send a
     * worker an instruction humanised into English, which is exactly what the allowlist exists to
     * prevent.
     *
     * <p>A null code is allowed through: those are plans drafted before SCRUM-119, and rejecting
     * them would make old recommendations undecidable.
     */
    private void assertActionCodesAreKnown(List<MitigationSuggestion> plan) {
        List<String> unknown = plan.stream()
                .map(MitigationSuggestion::actionCode)
                .filter(code -> code != null && !ActionCatalogue.isKnown(code))
                .distinct()
                .toList();

        if (!unknown.isEmpty()) {
            throw new BadRequestException("Unsupported action code(s): " + String.join(", ", unknown));
        }
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
