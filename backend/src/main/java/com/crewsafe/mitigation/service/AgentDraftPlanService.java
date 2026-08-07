package com.crewsafe.mitigation.service;

import com.crewsafe.mitigation.ai.bedrock.BedrockApiClient;
import com.crewsafe.mitigation.ai.bedrock.BedrockException;
import com.crewsafe.mitigation.ai.bedrock.BedrockTimeoutException;
import com.crewsafe.mitigation.domain.AgentDraftPlan;
import com.crewsafe.mitigation.repository.AgentDraftPlanRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Service for generating and managing agent draft plans using Bedrock AI.
 * Interfaces with Bedrock to create heat mitigation recommendations.
 *
 * @author Surya Kumaraguru
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AgentDraftPlanService {
    private final AgentDraftPlanRepository repository;
    private final BedrockApiClient bedrockApiClient;
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    /**
     * Generate a draft plan for heat mitigation operations using Bedrock AI.
     * Saves the generated plan to database for supervisor review.
     *
     * @param siteId the site for which to generate the plan
     * @param supervisorId the supervisor requesting the plan
     * @param context operational context (e.g., current conditions, worker status)
     * @return the generated draft plan
     * @throws BedrockTimeoutException if Bedrock API request times out
     * @throws BedrockException if Bedrock API call fails
     */
    @Transactional
    public AgentDraftPlan generateDraftPlan(UUID siteId, UUID supervisorId, String context) {
        log.info("Generating draft plan for site: {}, supervisor: {}", siteId, supervisorId);

        try {
            // Call Bedrock to get draft plan recommendations
            DraftPlanPrompt prompt = new DraftPlanPrompt(
                    "Generate a heat mitigation plan based on the following operational context:\n" + context
            );

            // Since BedrockApiClient doesn't have a direct draft plan method,
            // we'll use a structured prompt that returns JSON
            String bedrockResponse = callBedrockForDraftPlan(prompt.context());

            // Parse the response
            DraftPlanGeneration generation = parseDraftPlanResponse(bedrockResponse);

            // Create and save the draft plan
            AgentDraftPlan draftPlan = AgentDraftPlan.builder()
                    .siteId(siteId)
                    .supervisorId(supervisorId)
                    .planContext(context)
                    .recommendedActions(generation.recommendedActions)
                    .safetyConsiderations(generation.safetyConsiderations)
                    .estimatedDurationMinutes(generation.estimatedDurationMinutes)
                    .approvalStatus(AgentDraftPlan.ApprovalStatus.PENDING)
                    .build();

            AgentDraftPlan saved = repository.save(draftPlan);
            log.info("Draft plan generated successfully: id={}, status={}", saved.getId(), saved.getApprovalStatus());

            return saved;

        } catch (BedrockTimeoutException e) {
            log.error("Bedrock timeout while generating draft plan for site: {}", siteId, e);
            throw e;
        } catch (BedrockException e) {
            log.error("Bedrock error while generating draft plan for site: {}", siteId, e);
            throw e;
        }
    }

    /**
     * Helper method to call Bedrock with structured draft plan generation prompt.
     * In production, this would use Claude's function calling or structured output.
     */
    private String callBedrockForDraftPlan(String context) {
        // For now, using mitigation API as a proxy since full Bedrock agent draft endpoint
        // would be implemented via SCRUM-187 foundation
        // In real implementation, this calls Bedrock with a specific agent schema
        var batch = bedrockApiClient.generateMitigations(context);
        return batch.mitigations().toString();
    }

    /**
     * Parse Bedrock response into structured draft plan
     */
    private DraftPlanGeneration parseDraftPlanResponse(String response) {
        // Extract key information from Bedrock response
        // In production with proper structured output, this would be type-safe
        StringBuilder actions = new StringBuilder();
        StringBuilder safety = new StringBuilder();
        int estimatedMinutes = 30; // default

        try {
            // Simple parsing - in production use Claude's structured output
            if (response.contains("priority") && response.contains("action")) {
                actions.append("Generated mitigation actions:\n").append(response);
            }
            safety.append("Safety measures should include: proper hydration, rest breaks, worker monitoring");

        } catch (Exception e) {
            log.warn("Error parsing Bedrock response, using defaults", e);
            actions.append("Review operational conditions and implement appropriate heat stress measures");
            safety.append("Ensure compliance with heat safety guidelines");
        }

        return new DraftPlanGeneration(
                actions.toString(),
                safety.toString(),
                estimatedMinutes
        );
    }

    /**
     * Approve a draft plan (supervisor action)
     */
    @Transactional
    public AgentDraftPlan approveDraftPlan(UUID draftPlanId, UUID supervisorId) {
        log.info("Approving draft plan: {}", draftPlanId);

        AgentDraftPlan draftPlan = repository.findById(draftPlanId)
                .orElseThrow(() -> new IllegalArgumentException("Draft plan not found: " + draftPlanId));

        // Verify supervisor owns this plan
        if (!draftPlan.getSupervisorId().equals(supervisorId)) {
            throw new IllegalArgumentException("Supervisor cannot approve plan from another supervisor");
        }

        draftPlan.setApprovalStatus(AgentDraftPlan.ApprovalStatus.APPROVED);
        draftPlan.setApprovedAt(Instant.now());

        AgentDraftPlan saved = repository.save(draftPlan);
        log.info("Draft plan approved: id={}", saved.getId());

        return saved;
    }

    /**
     * Reject a draft plan (supervisor action)
     */
    @Transactional
    public AgentDraftPlan rejectDraftPlan(UUID draftPlanId, UUID supervisorId) {
        log.info("Rejecting draft plan: {}", draftPlanId);

        AgentDraftPlan draftPlan = repository.findById(draftPlanId)
                .orElseThrow(() -> new IllegalArgumentException("Draft plan not found: " + draftPlanId));

        // Verify supervisor owns this plan
        if (!draftPlan.getSupervisorId().equals(supervisorId)) {
            throw new IllegalArgumentException("Supervisor cannot reject plan from another supervisor");
        }

        draftPlan.setApprovalStatus(AgentDraftPlan.ApprovalStatus.REJECTED);

        AgentDraftPlan saved = repository.save(draftPlan);
        log.info("Draft plan rejected: id={}", saved.getId());

        return saved;
    }

    /**
     * Get draft plan by ID
     */
    public AgentDraftPlan getDraftPlan(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Draft plan not found: " + id));
    }

    /**
     * Get all pending draft plans for a supervisor at a site
     */
    public List<AgentDraftPlan> getPendingDraftPlans(UUID siteId, UUID supervisorId) {
        return repository.findBySiteIdAndSupervisorIdAndApprovalStatus(
                siteId,
                supervisorId,
                AgentDraftPlan.ApprovalStatus.PENDING
        );
    }

    /**
     * Get all draft plans for a supervisor
     */
    public List<AgentDraftPlan> getDraftPlansForSupervisor(UUID supervisorId) {
        return repository.findBySupervisorId(supervisorId);
    }

    // ===== Internal Records =====

    record DraftPlanPrompt(String context) {}

    record DraftPlanGeneration(
            String recommendedActions,
            String safetyConsiderations,
            int estimatedDurationMinutes
    ) {}
}
