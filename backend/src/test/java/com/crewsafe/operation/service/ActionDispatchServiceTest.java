package com.crewsafe.operation.service;

import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.domain.Approval;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.repository.ActionDispatchRepository;
import com.crewsafe.operation.repository.ApprovalRepository;
import com.crewsafe.wellbeing.service.WellbeingService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.security.access.AccessDeniedException;

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
    private AppUserRepository appUserRepository;

    @Mock
    private AuditService auditService;

    /* US-11: a completed rest dispatch is also logged as a rest. Mocked rather than asserted on
       here — the derivation itself is covered where it belongs, in WellbeingControllerTest. */
    @Mock
    private WellbeingService wellbeingService;

    private ActionDispatchService service;
    private UUID approvalId;
    private UUID workerId;
    private UUID dispatchId;
    private UUID supervisorId;
    private Approval approval;
    private ActionDispatch dispatch;
    private CrewSafeUserPrincipal principal;

    @BeforeEach
    void setUp() {
        service = new ActionDispatchService(actionDispatchRepository, approvalRepository, appUserRepository,
                auditService, wellbeingService);
        approvalId = UUID.randomUUID();
        workerId = UUID.randomUUID();
        supervisorId = UUID.randomUUID();
        dispatchId = UUID.randomUUID();

        // Create mock principal for supervisor. Not every test exercises both stubs below
        // (e.g. tests that fail before reaching the role/id check, or that use their own
        // worker principal instead), so they're lenient rather than duplicated per test.
        principal = mock(CrewSafeUserPrincipal.class);
        lenient().when(principal.getId()).thenReturn(supervisorId);
        lenient().when(principal.getRole()).thenReturn(Role.SUPERVISOR);

        AppUser approver = AppUser.builder()
                .id(supervisorId)
                .role(Role.SUPERVISOR)
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
                .role(Role.WORKER)
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
        AppUser worker = AppUser.builder().id(workerId).role(Role.WORKER).build();
        when(approvalRepository.findById(approvalId)).thenReturn(Optional.of(approval));
        when(appUserRepository.findById(workerId)).thenReturn(Optional.of(worker));
        when(actionDispatchRepository.save(any(ActionDispatch.class))).thenReturn(dispatch);

        ActionDispatch result = service.dispatchAction(approvalId, workerId, "REST_10_MIN", "Take a 10 minute rest", principal);

        assertNotNull(result);
        assertEquals("REST_10_MIN", result.getActionCode());
        assertEquals(ActionDispatch.ActionDispatchStatus.PENDING, result.getStatus());
        verify(auditService).record(eq(supervisorId), eq(AuditEventType.ACTION_DISPATCHED),
                eq("ACTION_DISPATCH"), eq(result.getId()), any());
    }

    @Test
    void testDispatchAction_ApprovalNotFound() {
        when(approvalRepository.findById(approvalId)).thenReturn(Optional.empty());

        assertThrows(IllegalArgumentException.class,
                () -> service.dispatchAction(approvalId, workerId, "REST_10_MIN", "Take rest", principal));
    }

    @Test
    void testDispatchAction_UnapprovedDecision() {
        Approval unapprovedApproval = Approval.builder()
                .id(approvalId)
                .decision(Approval.ApprovalDecision.REJECTED)
                .build();

        when(approvalRepository.findById(approvalId)).thenReturn(Optional.of(unapprovedApproval));

        assertThrows(IllegalArgumentException.class,
                () -> service.dispatchAction(approvalId, workerId, "REST_10_MIN", "Take rest", principal));
    }

    @Test
    void testAcknowledgeDispatch_Idempotent() {
        // Create a worker principal
        CrewSafeUserPrincipal workerPrincipal = mock(CrewSafeUserPrincipal.class);
        when(workerPrincipal.getId()).thenReturn(workerId);

        when(actionDispatchRepository.findById(dispatchId)).thenReturn(Optional.of(dispatch));
        when(actionDispatchRepository.save(any(ActionDispatch.class))).thenReturn(dispatch);

        // First acknowledgement
        ActionDispatch first = service.acknowledgeDispatch(dispatchId, workerPrincipal);
        assertEquals(ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED, first.getStatus());

        // Second acknowledgement - should be idempotent
        dispatch.setStatus(ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED);
        ActionDispatch second = service.acknowledgeDispatch(dispatchId, workerPrincipal);
        assertEquals(ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED, second.getStatus());

        // Only one audit event should be recorded for the first acknowledgement
        verify(auditService).record(eq(workerId), eq(AuditEventType.ACTION_ACKNOWLEDGED),
                eq("ACTION_DISPATCH"), eq(dispatchId), any());
    }

    @Test
    void testCompleteDispatch_Idempotent() {
        // Create a worker principal
        CrewSafeUserPrincipal workerPrincipal = mock(CrewSafeUserPrincipal.class);
        when(workerPrincipal.getId()).thenReturn(workerId);

        when(actionDispatchRepository.findById(dispatchId)).thenReturn(Optional.of(dispatch));
        when(actionDispatchRepository.save(any(ActionDispatch.class))).thenReturn(dispatch);

        // First completion
        ActionDispatch first = service.completeDispatch(dispatchId, workerPrincipal);
        assertEquals(ActionDispatch.ActionDispatchStatus.COMPLETED, first.getStatus());

        // Second completion - should be idempotent
        dispatch.setStatus(ActionDispatch.ActionDispatchStatus.COMPLETED);
        ActionDispatch second = service.completeDispatch(dispatchId, workerPrincipal);
        assertEquals(ActionDispatch.ActionDispatchStatus.COMPLETED, second.getStatus());

        // Only one audit event should be recorded
        verify(auditService).record(eq(workerId), eq(AuditEventType.ACTION_COMPLETED),
                eq("ACTION_DISPATCH"), eq(dispatchId), any());
    }

    @Test
    void testGetDispatch_NotFound() {
        when(actionDispatchRepository.findById(dispatchId)).thenReturn(Optional.empty());

        assertThrows(IllegalArgumentException.class, () -> service.getDispatch(dispatchId, principal));
    }

    @Test
    void testGetDispatch_Success() {
        when(actionDispatchRepository.findById(dispatchId)).thenReturn(Optional.of(dispatch));

        ActionDispatch result = service.getDispatch(dispatchId, principal);
        assertEquals(dispatchId, result.getId());
        assertEquals("REST_10_MIN", result.getActionCode());
    }

    @Test
    void testGetDispatch_WorkerCanViewOwnDispatch() {
        // Create a worker principal who owns the dispatch
        CrewSafeUserPrincipal workerPrincipal = mock(CrewSafeUserPrincipal.class);
        when(workerPrincipal.getId()).thenReturn(workerId);
        // Note: getRole() stub not needed here because when IDs match, authorization check passes via short-circuit

        when(actionDispatchRepository.findById(dispatchId)).thenReturn(Optional.of(dispatch));

        ActionDispatch result = service.getDispatch(dispatchId, workerPrincipal);
        assertEquals(dispatchId, result.getId());
    }

    @Test
    void testGetDispatch_WorkerCannotViewOtherWorkerDispatch() {
        // Create a different worker principal who does NOT own the dispatch
        UUID otherWorkerId = UUID.randomUUID();
        CrewSafeUserPrincipal otherWorkerPrincipal = mock(CrewSafeUserPrincipal.class);
        when(otherWorkerPrincipal.getId()).thenReturn(otherWorkerId);
        when(otherWorkerPrincipal.getRole()).thenReturn(Role.WORKER);

        when(actionDispatchRepository.findById(dispatchId)).thenReturn(Optional.of(dispatch));

        assertThrows(AccessDeniedException.class,
                () -> service.getDispatch(dispatchId, otherWorkerPrincipal));
    }

    @Test
    void testGetDispatch_SupervisorCanViewAnyDispatch() {
        when(actionDispatchRepository.findById(dispatchId)).thenReturn(Optional.of(dispatch));

        ActionDispatch result = service.getDispatch(dispatchId, principal);
        assertEquals(dispatchId, result.getId());
    }

    @Test
    void testGetDispatch_SafetyManagerCanViewAnyDispatch() {
        // Create a safety manager principal
        CrewSafeUserPrincipal safetyManagerPrincipal = mock(CrewSafeUserPrincipal.class);
        when(safetyManagerPrincipal.getId()).thenReturn(UUID.randomUUID());
        when(safetyManagerPrincipal.getRole()).thenReturn(Role.SAFETY_MANAGER);

        when(actionDispatchRepository.findById(dispatchId)).thenReturn(Optional.of(dispatch));

        ActionDispatch result = service.getDispatch(dispatchId, safetyManagerPrincipal);
        assertEquals(dispatchId, result.getId());
    }
}
