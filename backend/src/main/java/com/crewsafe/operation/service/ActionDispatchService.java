package com.crewsafe.operation.service;

import com.crewsafe.common.audit.AuditService;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.domain.Approval;
import com.crewsafe.operation.repository.ActionDispatchRepository;
import com.crewsafe.operation.repository.ApprovalRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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

    private final ActionDispatchRepository actionDispatchRepository;
    private final ApprovalRepository approvalRepository;
    private final AuditService auditService;

    @Transactional
    public ActionDispatch dispatchAction(UUID approvalId, UUID workerId, String actionCode, String instruction) {
        Approval approval = approvalRepository.findById(approvalId)
                .orElseThrow(() -> new IllegalArgumentException("Approval not found: " + approvalId));

        if (!approval.getDecision().equals(Approval.ApprovalDecision.APPROVED)) {
            throw new IllegalArgumentException("Can only dispatch actions from approved decisions");
        }

        ActionDispatch dispatch = ActionDispatch.builder()
                .id(UUID.randomUUID())
                .approval(approval)
                .worker(approval.getApprover()) // Placeholder: will be resolved properly from AppUser repo
                .actionCode(actionCode)
                .instruction(instruction)
                .status(ActionDispatch.ActionDispatchStatus.PENDING)
                .dispatchedAt(Instant.now())
                .build();

        ActionDispatch saved = actionDispatchRepository.save(dispatch);
        auditService.record(null, "ACTION_DISPATCHED", "action_dispatch", saved.getId(),
                "Action dispatched: " + actionCode + " to worker: " + workerId);
        log.info("Action dispatched: {} to worker: {}", actionCode, workerId);

        return saved;
    }

    @Transactional
    public ActionDispatch acknowledgeDispatch(UUID dispatchId) {
        ActionDispatch dispatch = actionDispatchRepository.findById(dispatchId)
                .orElseThrow(() -> new IllegalArgumentException("ActionDispatch not found: " + dispatchId));

        // Idempotent: if already acknowledged, return existing state
        if (dispatch.getStatus() == ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED) {
            log.info("Action dispatch already acknowledged: {}", dispatchId);
            return dispatch;
        }

        dispatch.setStatus(ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED);
        ActionDispatch saved = actionDispatchRepository.save(dispatch);
        auditService.record(null, "ACTION_ACKNOWLEDGED", "action_dispatch", saved.getId(),
                "Action acknowledged: " + dispatchId);
        log.info("Action dispatch acknowledged: {}", dispatchId);

        return saved;
    }

    @Transactional
    public ActionDispatch completeDispatch(UUID dispatchId) {
        ActionDispatch dispatch = actionDispatchRepository.findById(dispatchId)
                .orElseThrow(() -> new IllegalArgumentException("ActionDispatch not found: " + dispatchId));

        // Idempotent: if already completed, return existing state
        if (dispatch.getStatus() == ActionDispatch.ActionDispatchStatus.COMPLETED) {
            log.info("Action dispatch already completed: {}", dispatchId);
            return dispatch;
        }

        dispatch.setStatus(ActionDispatch.ActionDispatchStatus.COMPLETED);
        dispatch.setEndTime(Instant.now());
        ActionDispatch saved = actionDispatchRepository.save(dispatch);
        auditService.record(null, "ACTION_COMPLETED", "action_dispatch", saved.getId(),
                "Action completed: " + dispatchId);
        log.info("Action dispatch completed: {}", dispatchId);

        return saved;
    }

    public List<ActionDispatch> getDispatchesForApproval(UUID approvalId) {
        return actionDispatchRepository.findByApprovalId(approvalId);
    }

    public List<ActionDispatch> getPendingDispatchesForWorker(UUID workerId) {
        return actionDispatchRepository.findPendingByWorkerId(workerId);
    }

    public ActionDispatch getDispatch(UUID dispatchId) {
        return actionDispatchRepository.findById(dispatchId)
                .orElseThrow(() -> new IllegalArgumentException("ActionDispatch not found: " + dispatchId));
    }
}
