package com.crewsafe.mitigation.api;

import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.mitigation.ai.bedrock.BedrockException;
import com.crewsafe.mitigation.ai.bedrock.BedrockTimeoutException;
import com.crewsafe.mitigation.domain.AgentDraftPlan;
import com.crewsafe.mitigation.service.AgentDraftPlanService;
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

/**
 * REST controller for agent-generated draft plans.
 * Supervisors use these endpoints to request, review, and approve draft heat mitigation plans.
 *
 * @author Surya Kumaraguru
 */
@RestController
@RequestMapping("/api/supervisor/agent-plans")
@RequiredArgsConstructor
@Slf4j
public class AgentDraftPlanController {
    private final AgentDraftPlanService draftPlanService;

    /**
     * Generate a new agent draft plan for heat mitigation operations.
     * POST /api/supervisor/agent-plans
     *
     * @param request contains site ID and operational context
     * @param principal authenticated supervisor
     * @return newly generated draft plan
     */
    @PostMapping
    @PreAuthorize("hasRole('SUPERVISOR')")
    public ResponseEntity<?> generateDraftPlan(
            @Valid @RequestBody GenerateAgentDraftPlanRequest request,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        log.info("Generating draft plan for site: {} by supervisor: {}", request.siteId(), principal.getId());

        try {
            AgentDraftPlan draftPlan = draftPlanService.generateDraftPlan(
                    request.siteId(),
                    principal.getId(),
                    request.planContext()
            );

            AgentDraftPlanResponse response = AgentDraftPlanResponse.fromEntity(draftPlan);
            return ResponseEntity.status(HttpStatus.CREATED).body(response);

        } catch (BedrockTimeoutException e) {
            log.error("Bedrock timeout while generating draft plan", e);
            return ResponseEntity.status(HttpStatus.GATEWAY_TIMEOUT)
                    .body(new ErrorResponse(
                            "Agent API timeout - request took too long",
                            "agent_timeout"
                    ));

        } catch (BedrockException e) {
            log.error("Bedrock error while generating draft plan", e);
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(new ErrorResponse(
                            "Agent API error - unable to generate plan",
                            "agent_error"
                    ));

        } catch (IllegalArgumentException e) {
            log.warn("Invalid request for draft plan generation", e);
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(new ErrorResponse(e.getMessage(), "invalid_request"));

        } catch (Exception e) {
            log.error("Unexpected error generating draft plan", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new ErrorResponse(
                            "Internal server error",
                            "internal_error"
                    ));
        }
    }

    /**
     * Retrieve a specific draft plan by ID.
     * GET /api/supervisor/agent-plans/{draftPlanId}
     *
     * @param draftPlanId the ID of the draft plan
     * @return the draft plan details
     */
    @GetMapping("/{draftPlanId}")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER')")
    public ResponseEntity<?> getDraftPlan(
            @PathVariable UUID draftPlanId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        log.info("Retrieving draft plan: {} by user: {}", draftPlanId, principal.getId());

        try {
            AgentDraftPlan draftPlan = draftPlanService.getDraftPlan(draftPlanId);
            AgentDraftPlanResponse response = AgentDraftPlanResponse.fromEntity(draftPlan);
            return ResponseEntity.ok(response);

        } catch (IllegalArgumentException e) {
            log.warn("Draft plan not found: {}", draftPlanId);
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ErrorResponse("Draft plan not found", "not_found"));
        }
    }

    /**
     * Get all pending draft plans for a supervisor at a specific site.
     * GET /api/supervisor/agent-plans/site/{siteId}/pending
     *
     * @param siteId the site ID
     * @param principal authenticated supervisor
     * @return list of pending draft plans
     */
    @GetMapping("/site/{siteId}/pending")
    @PreAuthorize("hasRole('SUPERVISOR')")
    public ResponseEntity<?> getPendingPlans(
            @PathVariable UUID siteId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        log.info("Fetching pending draft plans for site: {} supervisor: {}", siteId, principal.getId());

        try {
            List<AgentDraftPlan> plans = draftPlanService.getPendingDraftPlans(siteId, principal.getId());
            List<AgentDraftPlanResponse> responses = plans.stream()
                    .map(AgentDraftPlanResponse::fromEntity)
                    .toList();

            return ResponseEntity.ok(responses);

        } catch (Exception e) {
            log.error("Error fetching pending draft plans", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new ErrorResponse("Internal server error", "internal_error"));
        }
    }

    /**
     * Approve a draft plan (move to APPROVED status).
     * POST /api/supervisor/agent-plans/{draftPlanId}/approve
     *
     * @param draftPlanId the ID of the draft plan to approve
     * @param principal authenticated supervisor
     * @return the approved draft plan
     */
    @PostMapping("/{draftPlanId}/approve")
    @PreAuthorize("hasRole('SUPERVISOR')")
    public ResponseEntity<?> approveDraftPlan(
            @PathVariable UUID draftPlanId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        log.info("Approving draft plan: {} by supervisor: {}", draftPlanId, principal.getId());

        try {
            AgentDraftPlan approved = draftPlanService.approveDraftPlan(draftPlanId, principal.getId());
            AgentDraftPlanResponse response = AgentDraftPlanResponse.fromEntity(approved);
            return ResponseEntity.ok(response);

        } catch (IllegalArgumentException e) {
            log.warn("Cannot approve draft plan", e);
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(new ErrorResponse(e.getMessage(), "invalid_operation"));

        } catch (Exception e) {
            log.error("Error approving draft plan", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new ErrorResponse("Internal server error", "internal_error"));
        }
    }

    /**
     * Reject a draft plan (move to REJECTED status).
     * POST /api/supervisor/agent-plans/{draftPlanId}/reject
     *
     * @param draftPlanId the ID of the draft plan to reject
     * @param principal authenticated supervisor
     * @return the rejected draft plan
     */
    @PostMapping("/{draftPlanId}/reject")
    @PreAuthorize("hasRole('SUPERVISOR')")
    public ResponseEntity<?> rejectDraftPlan(
            @PathVariable UUID draftPlanId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        log.info("Rejecting draft plan: {} by supervisor: {}", draftPlanId, principal.getId());

        try {
            AgentDraftPlan rejected = draftPlanService.rejectDraftPlan(draftPlanId, principal.getId());
            AgentDraftPlanResponse response = AgentDraftPlanResponse.fromEntity(rejected);
            return ResponseEntity.ok(response);

        } catch (IllegalArgumentException e) {
            log.warn("Cannot reject draft plan", e);
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(new ErrorResponse(e.getMessage(), "invalid_operation"));

        } catch (Exception e) {
            log.error("Error rejecting draft plan", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new ErrorResponse("Internal server error", "internal_error"));
        }
    }

    /**
     * Get all draft plans for the current supervisor.
     * GET /api/supervisor/agent-plans/mine
     *
     * @param principal authenticated supervisor
     * @return list of all draft plans for this supervisor
     */
    @GetMapping("/mine")
    @PreAuthorize("hasRole('SUPERVISOR')")
    public ResponseEntity<?> getMyDraftPlans(
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        log.info("Fetching all draft plans for supervisor: {}", principal.getId());

        try {
            List<AgentDraftPlan> plans = draftPlanService.getDraftPlansForSupervisor(principal.getId());
            List<AgentDraftPlanResponse> responses = plans.stream()
                    .map(AgentDraftPlanResponse::fromEntity)
                    .toList();

            return ResponseEntity.ok(responses);

        } catch (Exception e) {
            log.error("Error fetching supervisor draft plans", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(new ErrorResponse("Internal server error", "internal_error"));
        }
    }

    // ===== Helper Record =====

    record ErrorResponse(String message, String errorCode) {}
}
