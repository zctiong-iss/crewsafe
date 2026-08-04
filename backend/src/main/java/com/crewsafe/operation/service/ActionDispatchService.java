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
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Service for action dispatch operations - handles dispatching actions to specific workers
 * and managing acknowledgements with full idempotency support.
 *
 * @author Surya Kumaraguru
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

    @Transactional
    public ActionDispatch dispatchAction(UUID approvalId, UUID workerId, String actionCode, String instruction,
                                         @AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        Approval approval = approvalRepository.findById(approvalId)
                .orElseThrow(() -> new IllegalArgumentException("Approval not found: " + approvalId));

        if (!approval.getDecision().equals(Approval.ApprovalDecision.APPROVED)) {
            throw new IllegalArgumentException("Can only dispatch actions from approved decisions");
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

        return saved;
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

    public ActionDispatch getDispatch(UUID dispatchId) {
        return actionDispatchRepository.findById(dispatchId)
                .orElseThrow(() -> new IllegalArgumentException("ActionDispatch not found: " + dispatchId));
    }
}
