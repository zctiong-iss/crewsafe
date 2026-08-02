package com.crewsafe.operation.service;

import com.crewsafe.common.audit.AuditService;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.domain.Approval;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.repository.ActionDispatchRepository;
import com.crewsafe.operation.repository.ApprovalRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for ActionDispatchService.
 *
 * @author Surya Kumaraguru
 */
@ExtendWith(MockitoExtension.class)
class ActionDispatchServiceTest {

    @Mock
    private ActionDispatchRepository actionDispatchRepository;

    @Mock
    private ApprovalRepository approvalRepository;

    @Mock
    private AuditService auditService;

    private ActionDispatchService service;
    private UUID approvalId;
    private UUID workerId;
    private UUID dispatchId;
    private Approval approval;
    private ActionDispatch dispatch;

    @BeforeEach
    void setUp() {
        service = new ActionDispatchService(actionDispatchRepository, approvalRepository, auditService);
        approvalId = UUID.randomUUID();
        workerId = UUID.randomUUID();
        dispatchId = UUID.randomUUID();

        AppUser approver = AppUser.builder()
                .id(UUID.randomUUID())
                .build();

        Recommendation recommendation = Recommendation.builder()
                .id(UUID.randomUUID())
                .status(Recommendation.RecommendationStatus.APPROVED)
                .build();

        approval = Approval.builder()
                .id(approvalId)
                .recommendation(recommendation)
                .approver(approver)
                .decision(Approval.ApprovalDecision.APPROVED)
                .decidedAt(Instant.now())
                .build();

        AppUser worker = AppUser.builder()
                .id(workerId)
                .build();

        dispatch = ActionDispatch.builder()
                .id(dispatchId)
                .approval(approval)
                .worker(worker)
                .actionCode("REST_10_MIN")
                .instruction("Take a 10 minute rest")
                .status(ActionDispatch.ActionDispatchStatus.PENDING)
                .dispatchedAt(Instant.now())
                .build();
    }

    @Test
    void testDispatchAction_Success() {
        when(approvalRepository.findById(approvalId)).thenReturn(Optional.of(approval));
        when(actionDispatchRepository.save(any(ActionDispatch.class))).thenReturn(dispatch);

        ActionDispatch result = service.dispatchAction(approvalId, workerId, "REST_10_MIN", "Take a 10 minute rest");

        assertNotNull(result);
        assertEquals("REST_10_MIN", result.getActionCode());
        assertEquals(ActionDispatch.ActionDispatchStatus.PENDING, result.getStatus());
        verify(auditService).record(isNull(), eq("ACTION_DISPATCHED"), eq("action_dispatch"), eq(result.getId()), any());
    }

    @Test
    void testDispatchAction_ApprovalNotFound() {
        when(approvalRepository.findById(approvalId)).thenReturn(Optional.empty());

        assertThrows(IllegalArgumentException.class,
                () -> service.dispatchAction(approvalId, workerId, "REST_10_MIN", "Take rest"));
    }

    @Test
    void testDispatchAction_UnapprovedDecision() {
        Approval unapprovedApproval = Approval.builder()
                .id(approvalId)
                .decision(Approval.ApprovalDecision.REJECTED)
                .build();

        when(approvalRepository.findById(approvalId)).thenReturn(Optional.of(unapprovedApproval));

        assertThrows(IllegalArgumentException.class,
                () -> service.dispatchAction(approvalId, workerId, "REST_10_MIN", "Take rest"));
    }

    @Test
    void testAcknowledgeDispatch_Idempotent() {
        when(actionDispatchRepository.findById(dispatchId)).thenReturn(Optional.of(dispatch));
        when(actionDispatchRepository.save(any(ActionDispatch.class))).thenReturn(dispatch);

        // First acknowledgement
        ActionDispatch first = service.acknowledgeDispatch(dispatchId);
        assertEquals(ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED, first.getStatus());

        // Second acknowledgement - should be idempotent
        dispatch.setStatus(ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED);
        ActionDispatch second = service.acknowledgeDispatch(dispatchId);
        assertEquals(ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED, second.getStatus());

        // Only one audit event should be recorded for the first acknowledgement
        verify(auditService).record(isNull(), eq("ACTION_ACKNOWLEDGED"), eq("action_dispatch"), eq(dispatchId), any());
    }

    @Test
    void testCompleteDispatch_Idempotent() {
        when(actionDispatchRepository.findById(dispatchId)).thenReturn(Optional.of(dispatch));
        when(actionDispatchRepository.save(any(ActionDispatch.class))).thenReturn(dispatch);

        // First completion
        ActionDispatch first = service.completeDispatch(dispatchId);
        assertEquals(ActionDispatch.ActionDispatchStatus.COMPLETED, first.getStatus());

        // Second completion - should be idempotent
        dispatch.setStatus(ActionDispatch.ActionDispatchStatus.COMPLETED);
        ActionDispatch second = service.completeDispatch(dispatchId);
        assertEquals(ActionDispatch.ActionDispatchStatus.COMPLETED, second.getStatus());

        // Only one audit event should be recorded
        verify(auditService).record(isNull(), eq("ACTION_COMPLETED"), eq("action_dispatch"), eq(dispatchId), any());
    }

    @Test
    void testGetDispatch_NotFound() {
        when(actionDispatchRepository.findById(dispatchId)).thenReturn(Optional.empty());

        assertThrows(IllegalArgumentException.class, () -> service.getDispatch(dispatchId));
    }

    @Test
    void testGetDispatch_Success() {
        when(actionDispatchRepository.findById(dispatchId)).thenReturn(Optional.of(dispatch));

        ActionDispatch result = service.getDispatch(dispatchId);
        assertEquals(dispatchId, result.getId());
        assertEquals("REST_10_MIN", result.getActionCode());
    }
}
