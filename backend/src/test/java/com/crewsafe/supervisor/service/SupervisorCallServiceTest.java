package com.crewsafe.supervisor.service;

import com.crewsafe.common.error.ConflictException;
import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.common.error.UnauthorizedException;
import com.crewsafe.supervisor.domain.CallStatus;
import com.crewsafe.supervisor.domain.SupervisorCallSession;
import com.crewsafe.supervisor.repository.SupervisorCallSessionRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class SupervisorCallServiceTest {

    @Mock
    private SupervisorCallSessionRepository callSessionRepository;

    @InjectMocks
    private SupervisorCallService callService;

    private static final UUID WORKER_ID = UUID.randomUUID();
    private static final UUID SUPERVISOR_ID = UUID.randomUUID();
    private static final UUID SITE_ID = UUID.randomUUID();
    private static final UUID CALL_ID = UUID.randomUUID();

    @Test
    void testInitiateCallRequest() {
        // Arrange
        SupervisorCallSession expectedSession = SupervisorCallSession.builder()
            .id(CALL_ID)
            .siteId(SITE_ID)
            .workerId(WORKER_ID)
            .supervisorId(SUPERVISOR_ID)
            .status(CallStatus.PENDING)
            .initiatedAt(ZonedDateTime.now(ZoneId.of("UTC")))
            .notes("Help needed")
            .build();

        when(callSessionRepository.save(any())).thenReturn(expectedSession);

        // Act
        SupervisorCallSession result = callService.initiateCallRequest(
            WORKER_ID,
            SITE_ID,
            SUPERVISOR_ID,
            "Help needed"
        );

        // Assert
        assertNotNull(result);
        assertEquals(CallStatus.PENDING, result.getStatus());
        assertEquals(WORKER_ID, result.getWorkerId());
        assertEquals(SUPERVISOR_ID, result.getSupervisorId());
        verify(callSessionRepository, times(1)).save(any());
    }

    @Test
    void testAcceptCallRequest_Success() {
        // Arrange
        SupervisorCallSession session = SupervisorCallSession.builder()
            .id(CALL_ID)
            .siteId(SITE_ID)
            .workerId(WORKER_ID)
            .supervisorId(SUPERVISOR_ID)
            .status(CallStatus.PENDING)
            .initiatedAt(ZonedDateTime.now(ZoneId.of("UTC")))
            .build();

        when(callSessionRepository.findByIdAndSupervisorId(CALL_ID, SUPERVISOR_ID))
            .thenReturn(Optional.of(session));
        when(callSessionRepository.save(any())).thenReturn(session);

        // Act
        SupervisorCallSession result = callService.acceptCall(CALL_ID, SUPERVISOR_ID);

        // Assert
        assertNotNull(result);
        assertEquals(CallStatus.ACCEPTED, result.getStatus());
        assertNotNull(result.getAcceptedAt());
        verify(callSessionRepository, times(1)).save(any());
    }

    @Test
    void testAcceptCallRequest_NotFound() {
        // Arrange
        when(callSessionRepository.findByIdAndSupervisorId(CALL_ID, SUPERVISOR_ID))
            .thenReturn(Optional.empty());

        // Act & Assert
        assertThrows(ResourceNotFoundException.class, () ->
            callService.acceptCall(CALL_ID, SUPERVISOR_ID)
        );
        verify(callSessionRepository, never()).save(any());
    }

    @Test
    void testAcceptCallRequest_InvalidState() {
        // Arrange
        SupervisorCallSession session = SupervisorCallSession.builder()
            .id(CALL_ID)
            .siteId(SITE_ID)
            .workerId(WORKER_ID)
            .supervisorId(SUPERVISOR_ID)
            .status(CallStatus.REJECTED)
            .initiatedAt(ZonedDateTime.now(ZoneId.of("UTC")))
            .build();

        when(callSessionRepository.findByIdAndSupervisorId(CALL_ID, SUPERVISOR_ID))
            .thenReturn(Optional.of(session));

        // Act & Assert
        assertThrows(ConflictException.class, () ->
            callService.acceptCall(CALL_ID, SUPERVISOR_ID)
        );
        verify(callSessionRepository, never()).save(any());
    }

    @Test
    void testRejectCallRequest_Success() {
        // Arrange
        SupervisorCallSession session = SupervisorCallSession.builder()
            .id(CALL_ID)
            .siteId(SITE_ID)
            .workerId(WORKER_ID)
            .supervisorId(SUPERVISOR_ID)
            .status(CallStatus.PENDING)
            .initiatedAt(ZonedDateTime.now(ZoneId.of("UTC")))
            .build();

        when(callSessionRepository.findByIdAndSupervisorId(CALL_ID, SUPERVISOR_ID))
            .thenReturn(Optional.of(session));
        when(callSessionRepository.save(any())).thenReturn(session);

        // Act
        SupervisorCallSession result = callService.rejectCall(CALL_ID, SUPERVISOR_ID);

        // Assert
        assertNotNull(result);
        assertEquals(CallStatus.REJECTED, result.getStatus());
        assertNotNull(result.getEndedAt());
        verify(callSessionRepository, times(1)).save(any());
    }

    @Test
    void testEndCall_Success() {
        // Arrange
        SupervisorCallSession session = SupervisorCallSession.builder()
            .id(CALL_ID)
            .siteId(SITE_ID)
            .workerId(WORKER_ID)
            .supervisorId(SUPERVISOR_ID)
            .status(CallStatus.ACCEPTED)
            .initiatedAt(ZonedDateTime.now(ZoneId.of("UTC")).minusMinutes(5))
            .acceptedAt(ZonedDateTime.now(ZoneId.of("UTC")).minusMinutes(4))
            .build();

        when(callSessionRepository.findById(CALL_ID)).thenReturn(Optional.of(session));
        when(callSessionRepository.save(any())).thenReturn(session);

        // Act
        SupervisorCallSession result = callService.endCall(CALL_ID, WORKER_ID);

        // Assert
        assertNotNull(result);
        assertEquals(CallStatus.ENDED, result.getStatus());
        assertNotNull(result.getEndedAt());
        assertNotNull(result.getCallDurationSeconds());
        verify(callSessionRepository, times(1)).save(any());
    }

    @Test
    void testEndCall_UnauthorizedUser() {
        // Arrange
        SupervisorCallSession session = SupervisorCallSession.builder()
            .id(CALL_ID)
            .siteId(SITE_ID)
            .workerId(WORKER_ID)
            .supervisorId(SUPERVISOR_ID)
            .status(CallStatus.ACCEPTED)
            .build();

        UUID unauthorizedUserId = UUID.randomUUID();
        when(callSessionRepository.findById(CALL_ID)).thenReturn(Optional.of(session));

        // Act & Assert
        assertThrows(UnauthorizedException.class, () ->
            callService.endCall(CALL_ID, unauthorizedUserId)
        );
        verify(callSessionRepository, never()).save(any());
    }
}
