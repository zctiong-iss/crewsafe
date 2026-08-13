package com.crewsafe.supervisor.service;

import com.crewsafe.common.error.ConflictException;
import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.common.error.UnauthorizedException;
import com.crewsafe.supervisor.domain.CallStatus;
import com.crewsafe.supervisor.domain.SupervisorCallSession;
import com.crewsafe.supervisor.repository.SupervisorCallSessionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Service for managing supervisor-worker call sessions (SCRUM-132/201).
 *
 * Handles call initiation, acceptance, rejection, and termination.
 * Ensures proper authorization and state transitions.
 *
 * @author Surya Kumaraguru
 */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class SupervisorCallService {

    private final SupervisorCallSessionRepository callSessionRepository;

    /**
     * Initiate a call request from worker to supervisor.
     *
     * Creates a new call session in PENDING state.
     *
     * @param workerId the worker initiating the call
     * @param siteId the site where the call is being made
     * @param supervisorId the supervisor being called
     * @param notes optional notes from the worker
     * @return the created call session
     */
    public SupervisorCallSession initiateCallRequest(
            UUID workerId,
            UUID siteId,
            UUID supervisorId,
            String notes) {

        log.info("Worker {} initiating call to supervisor {} at site {}", workerId, supervisorId, siteId);

        SupervisorCallSession session = SupervisorCallSession.builder()
            .id(UUID.randomUUID())
            .siteId(siteId)
            .workerId(workerId)
            .supervisorId(supervisorId)
            .status(CallStatus.PENDING)
            .initiatedAt(ZonedDateTime.now(ZoneId.of("UTC")))
            .notes(notes)
            .build();

        SupervisorCallSession saved = callSessionRepository.save(session);
        log.info("Call session {} created", saved.getId());
        return saved;
    }

    /**
     * Accept a call request (supervisor action).
     *
     * Transitions call from PENDING to ACCEPTED state.
     *
     * @param callSessionId the call session ID
     * @param supervisorId the supervisor accepting the call
     * @return the updated call session
     * @throws ResourceNotFoundException if call not found
     * @throws ConflictException if call is not in PENDING state
     * @throws UnauthorizedException if supervisor doesn't match
     */
    public SupervisorCallSession acceptCall(UUID callSessionId, UUID supervisorId) {
        SupervisorCallSession session = callSessionRepository.findByIdAndSupervisorId(callSessionId, supervisorId)
            .orElseThrow(() -> new ResourceNotFoundException("Call session not found or supervisor mismatch"));

        if (session.getStatus() != CallStatus.PENDING) {
            throw new ConflictException("Call can only be accepted from PENDING state");
        }

        log.info("Supervisor {} accepting call {}", supervisorId, callSessionId);
        session.setStatus(CallStatus.ACCEPTED);
        session.setAcceptedAt(ZonedDateTime.now(ZoneId.of("UTC")));

        return callSessionRepository.save(session);
    }

    /**
     * Reject a call request (supervisor action).
     *
     * Transitions call from PENDING to REJECTED state.
     *
     * @param callSessionId the call session ID
     * @param supervisorId the supervisor rejecting the call
     * @return the updated call session
     * @throws ResourceNotFoundException if call not found
     * @throws ConflictException if call is not in PENDING state
     * @throws UnauthorizedException if supervisor doesn't match
     */
    public SupervisorCallSession rejectCall(UUID callSessionId, UUID supervisorId) {
        SupervisorCallSession session = callSessionRepository.findByIdAndSupervisorId(callSessionId, supervisorId)
            .orElseThrow(() -> new ResourceNotFoundException("Call session not found or supervisor mismatch"));

        if (session.getStatus() != CallStatus.PENDING) {
            throw new ConflictException("Call can only be rejected from PENDING state");
        }

        log.info("Supervisor {} rejecting call {}", supervisorId, callSessionId);
        session.setStatus(CallStatus.REJECTED);
        session.setEndedAt(ZonedDateTime.now(ZoneId.of("UTC")));

        return callSessionRepository.save(session);
    }

    /**
     * End an active call (either party can end).
     *
     * Transitions call from ACCEPTED to ENDED state.
     * Calculates call duration if call was accepted.
     *
     * @param callSessionId the call session ID
     * @param userId the user ending the call (worker or supervisor)
     * @return the updated call session
     * @throws ResourceNotFoundException if call not found
     * @throws UnauthorizedException if user is not part of this call
     */
    public SupervisorCallSession endCall(UUID callSessionId, UUID userId) {
        SupervisorCallSession session = callSessionRepository.findById(callSessionId)
            .orElseThrow(() -> new ResourceNotFoundException("Call session not found"));

        // Verify user is part of this call
        if (!session.getWorkerId().equals(userId) && !session.getSupervisorId().equals(userId)) {
            throw new UnauthorizedException("User not authorized to end this call");
        }

        log.info("User {} ending call {}", userId, callSessionId);

        // Calculate duration if call was accepted
        if (session.getStatus() == CallStatus.ACCEPTED && session.getAcceptedAt() != null) {
            ZonedDateTime now = ZonedDateTime.now(ZoneId.of("UTC"));
            Duration duration = Duration.between(session.getAcceptedAt(), now);
            session.setCallDurationSeconds((int) duration.getSeconds());
        }

        session.setStatus(CallStatus.ENDED);
        session.setEndedAt(ZonedDateTime.now(ZoneId.of("UTC")));

        return callSessionRepository.save(session);
    }

    /**
     * Get call history for a user (worker or supervisor).
     *
     * Returns calls ordered by most recent first.
     *
     * @param userId the user's ID (worker or supervisor)
     * @param limit the maximum number of results
     * @return list of call sessions
     */
    @Transactional(readOnly = true)
    public List<SupervisorCallSession> getCallHistory(UUID userId, int limit) {
        List<SupervisorCallSession> history = callSessionRepository.findByWorkerIdOrderByInitiatedAtDesc(userId);

        if (history.isEmpty()) {
            // Try supervisor queries
            history = callSessionRepository.findBySupervisorIdOrderByInitiatedAtDesc(userId);
        }

        return history.stream()
            .limit(limit)
            .toList();
    }

    /**
     * Get pending calls for a supervisor.
     *
     * @param supervisorId the supervisor's user ID
     * @return list of pending call sessions
     */
    @Transactional(readOnly = true)
    public List<SupervisorCallSession> getPendingCalls(UUID supervisorId) {
        return callSessionRepository.findBySiteIdAndStatusOrderByInitiatedAtDesc(null, CallStatus.PENDING)
            .stream()
            .filter(call -> call.getSupervisorId().equals(supervisorId))
            .toList();
    }

    /**
     * Count pending calls for a supervisor.
     *
     * @param supervisorId the supervisor's user ID
     * @return number of pending calls
     */
    @Transactional(readOnly = true)
    public long countPendingCalls(UUID supervisorId) {
        return callSessionRepository.countBySupervisorIdAndStatus(supervisorId, CallStatus.PENDING);
    }
}
