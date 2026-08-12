package com.crewsafe.supervisor.api;

import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.supervisor.domain.SupervisorCallSession;
import com.crewsafe.supervisor.service.SupervisorCallService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * REST controller for supervisor call sessions (SCRUM-132/201).
 *
 * Endpoints for initiating calls, accepting/rejecting calls, and viewing call history.
 * Workers can initiate calls to supervisors.
 * Supervisors can accept/reject/end calls.
 *
 * @author Surya Kumaraguru
 */
@RestController
@RequestMapping("/api/supervisor/calls")
@RequiredArgsConstructor
@Slf4j
public class SupervisorCallController {

    private final SupervisorCallService callService;

    /**
     * POST /api/supervisor/calls
     *
     * Worker initiates a call to supervisor.
     *
     * @param request contains site ID and optional notes
     * @param principal authenticated worker user
     * @return 201 Created with call session details
     */
    @PostMapping
    @PreAuthorize("hasAnyRole('WORKER', 'SUPERVISOR')")
    public ResponseEntity<SupervisorCallResponse> initiateCall(
            @Valid @RequestBody InitiateCallRequest request,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        log.info("User {} initiating call for site {}", principal.getId(), request.siteId());

        // Get supervisor for site (placeholder - implement per business logic)
        // For now, assuming supervisor ID is provided or derived from site
        UUID supervisorId = request.siteId(); // TODO: Implement supervisor lookup

        SupervisorCallSession session = callService.initiateCallRequest(
            principal.getId(),
            request.siteId(),
            supervisorId,
            request.notes()
        );

        return ResponseEntity.status(HttpStatus.CREATED)
            .body(SupervisorCallResponse.from(session));
    }

    /**
     * POST /api/supervisor/calls/{callId}/accept
     *
     * Supervisor accepts a pending call.
     *
     * @param callId the call session ID
     * @param principal authenticated supervisor user
     * @return 200 OK with updated call session
     */
    @PostMapping("/{callId}/accept")
    @PreAuthorize("hasRole('SUPERVISOR')")
    public ResponseEntity<SupervisorCallResponse> acceptCall(
            @PathVariable UUID callId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        log.info("Supervisor {} accepting call {}", principal.getId(), callId);

        SupervisorCallSession session = callService.acceptCall(callId, principal.getId());

        return ResponseEntity.ok(SupervisorCallResponse.from(session));
    }

    /**
     * POST /api/supervisor/calls/{callId}/reject
     *
     * Supervisor rejects a pending call.
     *
     * @param callId the call session ID
     * @param principal authenticated supervisor user
     * @return 200 OK with updated call session
     */
    @PostMapping("/{callId}/reject")
    @PreAuthorize("hasRole('SUPERVISOR')")
    public ResponseEntity<SupervisorCallResponse> rejectCall(
            @PathVariable UUID callId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        log.info("Supervisor {} rejecting call {}", principal.getId(), callId);

        SupervisorCallSession session = callService.rejectCall(callId, principal.getId());

        return ResponseEntity.ok(SupervisorCallResponse.from(session));
    }

    /**
     * POST /api/supervisor/calls/{callId}/end
     *
     * End an active call (either worker or supervisor).
     *
     * @param callId the call session ID
     * @param principal authenticated user (worker or supervisor)
     * @return 200 OK with updated call session
     */
    @PostMapping("/{callId}/end")
    @PreAuthorize("hasAnyRole('WORKER', 'SUPERVISOR')")
    public ResponseEntity<SupervisorCallResponse> endCall(
            @PathVariable UUID callId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        log.info("User {} ending call {}", principal.getId(), callId);

        SupervisorCallSession session = callService.endCall(callId, principal.getId());

        return ResponseEntity.ok(SupervisorCallResponse.from(session));
    }

    /**
     * GET /api/supervisor/calls/history
     *
     * Get call history for current user.
     *
     * @param principal authenticated user
     * @param limit maximum number of results (default 50)
     * @return 200 OK with list of call sessions
     */
    @GetMapping("/history")
    @PreAuthorize("hasAnyRole('WORKER', 'SUPERVISOR')")
    public ResponseEntity<List<SupervisorCallResponse>> getCallHistory(
            @AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @RequestParam(defaultValue = "50") int limit) {

        log.info("Getting call history for user {} (limit: {})", principal.getId(), limit);

        List<SupervisorCallSession> history = callService.getCallHistory(principal.getId(), limit);

        List<SupervisorCallResponse> responses = history.stream()
            .map(SupervisorCallResponse::from)
            .collect(Collectors.toList());

        return ResponseEntity.ok(responses);
    }

    /**
     * GET /api/supervisor/calls/pending
     *
     * Get pending calls for current supervisor.
     *
     * @param principal authenticated supervisor user
     * @return 200 OK with list of pending call sessions
     */
    @GetMapping("/pending")
    @PreAuthorize("hasRole('SUPERVISOR')")
    public ResponseEntity<List<SupervisorCallResponse>> getPendingCalls(
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        log.info("Getting pending calls for supervisor {}", principal.getId());

        List<SupervisorCallSession> pending = callService.getPendingCalls(principal.getId());

        List<SupervisorCallResponse> responses = pending.stream()
            .map(SupervisorCallResponse::from)
            .collect(Collectors.toList());

        return ResponseEntity.ok(responses);
    }

    /**
     * GET /api/supervisor/calls/pending/count
     *
     * Get count of pending calls for current supervisor.
     *
     * @param principal authenticated supervisor user
     * @return 200 OK with pending call count
     */
    @GetMapping("/pending/count")
    @PreAuthorize("hasRole('SUPERVISOR')")
    public ResponseEntity<Long> countPendingCalls(
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        log.info("Getting pending call count for supervisor {}", principal.getId());

        long count = callService.countPendingCalls(principal.getId());

        return ResponseEntity.ok(count);
    }
}
