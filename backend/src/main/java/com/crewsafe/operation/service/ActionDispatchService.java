package com.crewsafe.operation.service;

import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.operation.config.ActionDispatchProperties;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.domain.Approval;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.repository.ActionDispatchRepository;
import com.crewsafe.operation.repository.ApprovalRepository;
import com.crewsafe.wellbeing.service.WellbeingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Service for action dispatch operations - handles dispatching actions to specific workers
 * and managing acknowledgements with full idempotency support.
 *
 * @author Surya Kumaraguru
 * @author Justin Chua
 * @author Jemilin Beulah
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ActionDispatchService {

    private static final String ACTION_DISPATCH_NOT_FOUND = "ActionDispatch not found: ";

    private static final String AUDIT_TARGET_TYPE = "ACTION_DISPATCH";

    private final ActionDispatchRepository actionDispatchRepository;
    private final ApprovalRepository approvalRepository;
    private final AppUserRepository appUserRepository;
    private final AuditService auditService;
    /** Derives a wellbeing rest log from a completed rest dispatch — see {@code recordRestIfThisWasOne}. */
    private final WellbeingService wellbeingService;
    /** Ack-window / auto-complete-window for {@link #markLateDispatches} and {@link #autoCompleteDispatches} (SCRUM-324). */
    private final ActionDispatchProperties properties;
    private final Clock clock;

    /**
     * {@code REQUIRES_NEW} rather than the default propagation: SCRUM-193 calls this from
     * within another transaction's {@code afterCommit} callback, where Spring's transaction
     * synchronization is still technically bound to the thread even though the physical commit
     * has already happened. Default propagation would silently "join" that tail end instead of
     * opening a genuinely new transaction, so the write here would run without ever being
     * durably committed. {@link AuditService#record} already forces {@code REQUIRES_NEW} for
     * exactly this reason. Harmless for this method's other caller (the controller, which has
     * no ambient transaction to begin with).
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public ActionDispatch dispatchAction(UUID approvalId, UUID workerId, String actionCode, String instruction,
                                         @AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        Approval approval = approvalRepository.findById(approvalId)
                .orElseThrow(() -> new IllegalArgumentException("Approval not found: " + approvalId));

        if (approval.getDecision() == Approval.ApprovalDecision.REJECTED) {
            throw new IllegalArgumentException("Cannot dispatch actions from a rejected decision");
        }

        AppUser worker = appUserRepository.findById(workerId)
                .orElseThrow(() -> new IllegalArgumentException("Worker not found: " + workerId));

        ActionDispatch dispatch = ActionDispatch.builder()
                .id(UUID.randomUUID())
                .recommendation(approval.getRecommendation())
                .approval(approval)
                .worker(worker)
                .actionCode(actionCode)
                .instruction(instruction)
                .status(ActionDispatch.ActionDispatchStatus.PENDING)
                .dispatchedAt(Instant.now())
                .build();

        ActionDispatch saved = actionDispatchRepository.save(dispatch);
        auditService.record(principal.getId(), AuditEventType.ACTION_DISPATCHED,
                AUDIT_TARGET_TYPE, saved.getId(),
                "Action dispatched: " + actionCode + " to worker: " + workerId);
        log.info("action_dispatched");

        return saved;
    }

    /**
     * The SCRUM-440 counterpart to {@link #dispatchAction}: a lightning-immediate stop-work
     * skips the approval step entirely, so there is no {@code Approval}
     * to attribute this to. {@code actorId} is still whoever's request produced the draft --
     * null for the SCRUM-291 auto-trigger, but a real supervisor id when they pressed
     * "Generate" themselves and the draft happened to be a lightning stop-work; either way,
     * nobody made an approve/reject decision, which is what {@link #dispatchAction} attributes
     * an {@code Approval} to.
     *
     * <p>{@code REQUIRES_NEW} for the same reason as {@link #dispatchAction}: this is called
     * from {@code AgentDraftService}'s {@code afterCommit} callback, where Spring's
     * transaction synchronization is still bound to the thread even though the physical
     * commit already happened.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public ActionDispatch autoDispatchAction(Recommendation recommendation, UUID actorId, UUID workerId,
                                              String actionCode, String instruction) {
        AppUser worker = appUserRepository.findById(workerId)
                .orElseThrow(() -> new IllegalArgumentException("Worker not found: " + workerId));

        ActionDispatch dispatch = ActionDispatch.builder()
                .id(UUID.randomUUID())
                .recommendation(recommendation)
                .approval(null)
                .worker(worker)
                .actionCode(actionCode)
                .instruction(instruction)
                .status(ActionDispatch.ActionDispatchStatus.PENDING)
                .dispatchedAt(Instant.now())
                .build();

        ActionDispatch saved = actionDispatchRepository.save(dispatch);
        auditService.record(actorId, AuditEventType.ACTION_AUTO_DISPATCHED,
                AUDIT_TARGET_TYPE, saved.getId(),
                "Action auto-dispatched (no supervisor approval): " + actionCode + " to worker: " + workerId);
        log.info("action_auto_dispatched");

        return saved;
    }

    @Transactional
    public ActionDispatch acknowledgeDispatch(UUID dispatchId, @AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        ActionDispatch dispatch = actionDispatchRepository.findById(dispatchId)
                .orElseThrow(() -> new IllegalArgumentException(ACTION_DISPATCH_NOT_FOUND + dispatchId));

        // Authorization: verify the worker owns this dispatch
        if (!dispatch.getWorker().getId().equals(principal.getId())) {
            throw new AccessDeniedException("Worker can only acknowledge their own dispatches");
        }

        // Idempotent: if already acknowledged -- or already completed, which the SCRUM-324
        // auto-complete sweep can now reach without a worker's second tap -- return existing
        // state rather than dragging a COMPLETED dispatch back to ACKNOWLEDGED.
        if (dispatch.getStatus() == ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED
                || dispatch.getStatus() == ActionDispatch.ActionDispatchStatus.COMPLETED) {
            log.info("action_dispatch_already_acknowledged");
            return dispatch;
        }

        dispatch.setStatus(ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED);
        dispatch.setStartTime(Instant.now());
        ActionDispatch saved = actionDispatchRepository.save(dispatch);
        auditService.record(principal.getId(), AuditEventType.ACTION_ACKNOWLEDGED,
                AUDIT_TARGET_TYPE, saved.getId(), "Action acknowledged: " + dispatchId);
        log.info("action_dispatch_acknowledged");

        return saved;
    }

    @Transactional
    public ActionDispatch completeDispatch(UUID dispatchId, @AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        ActionDispatch dispatch = actionDispatchRepository.findById(dispatchId)
                .orElseThrow(() -> new IllegalArgumentException(ACTION_DISPATCH_NOT_FOUND + dispatchId));

        // Authorization: verify the worker owns this dispatch
        if (!dispatch.getWorker().getId().equals(principal.getId())) {
            throw new AccessDeniedException("Worker can only complete their own dispatches");
        }

        // Idempotent: if already completed, return existing state
        if (dispatch.getStatus() == ActionDispatch.ActionDispatchStatus.COMPLETED) {
            log.info("action_dispatch_already_completed");
            return dispatch;
        }

        dispatch.setStatus(ActionDispatch.ActionDispatchStatus.COMPLETED);
        dispatch.setEndTime(Instant.now());
        dispatch.setCompletedBy(ActionDispatch.CompletionSource.WORKER);
        ActionDispatch saved = actionDispatchRepository.save(dispatch);
        auditService.record(principal.getId(), AuditEventType.ACTION_COMPLETED,
                AUDIT_TARGET_TYPE, saved.getId(), "Action completed: " + dispatchId);
        log.info("action_dispatch_completed");

        recordRestIfThisWasOne(saved);

        return saved;
    }

    /**
     * Flips PENDING dispatches to LATE once they've sat unacknowledged past
     * {@code app.action-dispatch.ack-window} (SCRUM-317/324). Driven by {@link
     * ActionDispatchSweepScheduler}, not a worker action -- {@code actorId} is null the
     * way a failed-login {@code TOKEN_FIRST_SEEN} row has none.
     */
    @Transactional
    public int markLateDispatches() {
        Instant cutoff = Instant.now(clock).minus(properties.getAckWindow());
        List<ActionDispatch> candidates = actionDispatchRepository.findPendingDispatchedBefore(cutoff);

        for (ActionDispatch dispatch : candidates) {
            dispatch.setStatus(ActionDispatch.ActionDispatchStatus.LATE);
            dispatch.setLateAt(Instant.now(clock));
            ActionDispatch saved = actionDispatchRepository.save(dispatch);
            auditService.record(null, AuditEventType.ACTION_LATE,
                    AUDIT_TARGET_TYPE, saved.getId(), "Action went late (unacknowledged past ack window): " + saved.getId());
        }

        if (!candidates.isEmpty()) {
            log.info("action_dispatches_marked_late");
        }
        return candidates.size();
    }

    /**
     * Completes ACKNOWLEDGED dispatches once {@code app.action-dispatch.auto-complete-window}
     * has passed since {@code startTime} (SCRUM-317/324), whichever code the dispatch is --
     * the window is fixed, not parsed from {@code actionCode}. A worker's manual complete tap
     * always wins the race: it moves the row out of ACKNOWLEDGED, so the next sweep simply
     * won't find it here.
     */
    @Transactional
    public int autoCompleteDispatches() {
        Instant cutoff = Instant.now(clock).minus(properties.getAutoCompleteWindow());
        List<ActionDispatch> candidates = actionDispatchRepository.findAcknowledgedStartedBefore(cutoff);

        for (ActionDispatch dispatch : candidates) {
            dispatch.setStatus(ActionDispatch.ActionDispatchStatus.COMPLETED);
            dispatch.setEndTime(Instant.now(clock));
            dispatch.setCompletedBy(ActionDispatch.CompletionSource.SYSTEM);
            ActionDispatch saved = actionDispatchRepository.save(dispatch);
            auditService.record(null, AuditEventType.ACTION_AUTO_COMPLETED,
                    AUDIT_TARGET_TYPE, saved.getId(), "Action auto-completed (auto-complete window elapsed): " + saved.getId());
            recordRestIfThisWasOne(saved);
        }

        if (!candidates.isEmpty()) {
            log.info("action_dispatches_auto_completed");
        }
        return candidates.size();
    }

    /**
     * A completed rest dispatch is a rest that actually happened, so it is logged as one (US-11).
     *
     * <p>Without this, "has this crew rested?" would have two answers in two places: self-logged
     * rests in the wellbeing log, instructed ones only in this table. A supervisor should not have
     * to know which feature recorded a rest in order to see that it happened.
     *
     * <p>Keyed off the action code rather than the instruction text, for the reason the whole
     * catalogue exists: the text is server-authored English and matching on it would work here
     * and nowhere else.
     *
     * <p>Failures are logged and swallowed. The worker has completed their rest and the dispatch
     * says so — losing the derived wellbeing row is a reporting gap, and unwinding an
     * already-committed completion to protect a summary would be the worse outcome.
     */
    private void recordRestIfThisWasOne(ActionDispatch dispatch) {
        String actionCode = dispatch.getActionCode();
        if (actionCode == null || !actionCode.startsWith("REST_")) {
            return;
        }

        try {
            UUID shiftId = dispatch.getRecommendation().getShiftId();
            wellbeingService.recordInstructedRest(shiftId, dispatch.getWorker().getId(), dispatch.getId());
        } catch (RuntimeException e) {
            log.warn("instructed_rest_derivation_failed");
        }
    }

    public List<ActionDispatch> getDispatchesForApproval(UUID approvalId) {
        return actionDispatchRepository.findByApprovalId(approvalId);
    }

    public List<ActionDispatch> getPendingDispatchesForWorker(UUID workerId,
                                                               @AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        // Authorization: workers can only see their own dispatches
        if (!workerId.equals(principal.getId()) && !principal.getRole().name().equals("ADMIN")) {
            throw new AccessDeniedException("Workers can only view their own pending dispatches");
        }
        return actionDispatchRepository.findPendingByWorkerId(workerId);
    }

    public ActionDispatch getDispatch(UUID dispatchId, @AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        ActionDispatch dispatch = actionDispatchRepository.findById(dispatchId)
                .orElseThrow(() -> new IllegalArgumentException(ACTION_DISPATCH_NOT_FOUND + dispatchId));

        // Authorization: verify the worker owns this dispatch (or is supervisor/safety manager)
        if (!dispatch.getWorker().getId().equals(principal.getId()) &&
            !principal.getRole().name().equals("SUPERVISOR") &&
            !principal.getRole().name().equals("SAFETY_MANAGER")) {
            throw new AccessDeniedException("Worker can only view their own dispatches");
        }

        return dispatch;
    }
}
