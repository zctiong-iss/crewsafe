package com.crewsafe.operation.service;

import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.domain.Approval;
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

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Service for action dispatch operations - handles dispatching actions to specific workers
 * and managing acknowledgements with full idempotency support.
 *
 * @author Surya Kumaraguru
 * @author Justin Chua
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ActionDispatchService {

    private static final String AUDIT_TARGET_TYPE = "ACTION_DISPATCH";

    private final ActionDispatchRepository actionDispatchRepository;
    private final ApprovalRepository approvalRepository;
    private final AppUserRepository appUserRepository;
    private final AuditService auditService;
    /** Derives a wellbeing rest log from a completed rest dispatch — see {@code recordRestIfThisWasOne}. */
    private final WellbeingService wellbeingService;

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
        log.info("Action dispatched: {} to worker: {}", actionCode, workerId);

        return saved;
    }

    @Transactional
    public ActionDispatch acknowledgeDispatch(UUID dispatchId, @AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        ActionDispatch dispatch = actionDispatchRepository.findById(dispatchId)
                .orElseThrow(() -> new IllegalArgumentException("ActionDispatch not found: " + dispatchId));

        // Authorization: verify the worker owns this dispatch
        if (!dispatch.getWorker().getId().equals(principal.getId())) {
            throw new AccessDeniedException("Worker can only acknowledge their own dispatches");
        }

        // Idempotent: if already acknowledged, return existing state
        if (dispatch.getStatus() == ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED) {
            log.info("Action dispatch already acknowledged: {}", dispatchId);
            return dispatch;
        }

        dispatch.setStatus(ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED);
        dispatch.setStartTime(Instant.now());
        ActionDispatch saved = actionDispatchRepository.save(dispatch);
        auditService.record(principal.getId(), AuditEventType.ACTION_ACKNOWLEDGED,
                AUDIT_TARGET_TYPE, saved.getId(), "Action acknowledged: " + dispatchId);
        log.info("Action dispatch acknowledged: {}", dispatchId);

        return saved;
    }

    @Transactional
    public ActionDispatch completeDispatch(UUID dispatchId, @AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        ActionDispatch dispatch = actionDispatchRepository.findById(dispatchId)
                .orElseThrow(() -> new IllegalArgumentException("ActionDispatch not found: " + dispatchId));

        // Authorization: verify the worker owns this dispatch
        if (!dispatch.getWorker().getId().equals(principal.getId())) {
            throw new AccessDeniedException("Worker can only complete their own dispatches");
        }

        // Idempotent: if already completed, return existing state
        if (dispatch.getStatus() == ActionDispatch.ActionDispatchStatus.COMPLETED) {
            log.info("Action dispatch already completed: {}", dispatchId);
            return dispatch;
        }

        dispatch.setStatus(ActionDispatch.ActionDispatchStatus.COMPLETED);
        dispatch.setEndTime(Instant.now());
        ActionDispatch saved = actionDispatchRepository.save(dispatch);
        auditService.record(principal.getId(), AuditEventType.ACTION_COMPLETED,
                AUDIT_TARGET_TYPE, saved.getId(), "Action completed: " + dispatchId);
        log.info("Action dispatch completed: {}", dispatchId);

        recordRestIfThisWasOne(saved);

        return saved;
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
            UUID shiftId = dispatch.getApproval().getRecommendation().getShiftId();
            wellbeingService.recordInstructedRest(shiftId, dispatch.getWorker().getId(), dispatch.getId());
        } catch (RuntimeException e) {
            log.warn("Could not record an instructed rest for dispatch {}: {}", dispatch.getId(), e.toString());
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
                .orElseThrow(() -> new IllegalArgumentException("ActionDispatch not found: " + dispatchId));

        // Authorization: verify the worker owns this dispatch (or is supervisor/safety manager)
        if (!dispatch.getWorker().getId().equals(principal.getId()) &&
            !principal.getRole().name().equals("SUPERVISOR") &&
            !principal.getRole().name().equals("SAFETY_MANAGER")) {
            throw new AccessDeniedException("Worker can only view their own dispatches");
        }

        return dispatch;
    }
}
