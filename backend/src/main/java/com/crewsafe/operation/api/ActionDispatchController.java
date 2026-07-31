package com.crewsafe.operation.api;

import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.service.ActionDispatchService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * REST controller for action dispatch endpoints - provides API for dispatching actions
 * to specific workers and managing acknowledgements.
 *
 * @author Surya Kumaraguru
 */
@RestController
@RequestMapping("/api/action-dispatch")
@RequiredArgsConstructor
@Slf4j
public class ActionDispatchController {

    private final ActionDispatchService actionDispatchService;

    @PostMapping
    @PreAuthorize("hasRole('SUPERVISOR')")
    public ResponseEntity<ActionDispatchResponse> dispatchAction(
            @Valid @RequestBody DispatchActionRequest request) {
        log.info("Dispatching action: {} to worker: {}", request.getActionCode(), request.getWorkerId());

        ActionDispatch dispatch = actionDispatchService.dispatchAction(
                request.getApprovalId(),
                request.getWorkerId(),
                request.getActionCode(),
                request.getInstruction()
        );

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ActionDispatchResponse.fromEntity(dispatch));
    }

    @PostMapping("/{dispatchId}/acknowledge")
    @PreAuthorize("hasRole('WORKER')")
    public ResponseEntity<ActionDispatchResponse> acknowledgeDispatch(
            @PathVariable UUID dispatchId) {
        log.info("Acknowledging action dispatch: {}", dispatchId);

        ActionDispatch dispatch = actionDispatchService.acknowledgeDispatch(dispatchId);
        return ResponseEntity.ok(ActionDispatchResponse.fromEntity(dispatch));
    }

    @PostMapping("/{dispatchId}/complete")
    @PreAuthorize("hasRole('WORKER')")
    public ResponseEntity<ActionDispatchResponse> completeDispatch(
            @PathVariable UUID dispatchId) {
        log.info("Completing action dispatch: {}", dispatchId);

        ActionDispatch dispatch = actionDispatchService.completeDispatch(dispatchId);
        return ResponseEntity.ok(ActionDispatchResponse.fromEntity(dispatch));
    }

    @GetMapping("/approval/{approvalId}")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER')")
    public ResponseEntity<List<ActionDispatchResponse>> getDispatchesForApproval(
            @PathVariable UUID approvalId) {
        log.info("Fetching dispatches for approval: {}", approvalId);

        List<ActionDispatch> dispatches = actionDispatchService.getDispatchesForApproval(approvalId);
        List<ActionDispatchResponse> responses = dispatches.stream()
                .map(ActionDispatchResponse::fromEntity)
                .toList();

        return ResponseEntity.ok(responses);
    }

    @GetMapping("/worker/{workerId}/pending")
    @PreAuthorize("hasRole('WORKER')")
    public ResponseEntity<List<ActionDispatchResponse>> getPendingDispatchesForWorker(
            @PathVariable UUID workerId) {
        log.info("Fetching pending dispatches for worker: {}", workerId);

        List<ActionDispatch> dispatches = actionDispatchService.getPendingDispatchesForWorker(workerId);
        List<ActionDispatchResponse> responses = dispatches.stream()
                .map(ActionDispatchResponse::fromEntity)
                .toList();

        return ResponseEntity.ok(responses);
    }

    @GetMapping("/{dispatchId}")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'WORKER', 'SAFETY_MANAGER')")
    public ResponseEntity<ActionDispatchResponse> getDispatch(
            @PathVariable UUID dispatchId) {
        log.info("Fetching action dispatch: {}", dispatchId);

        ActionDispatch dispatch = actionDispatchService.getDispatch(dispatchId);
        return ResponseEntity.ok(ActionDispatchResponse.fromEntity(dispatch));
    }
}
