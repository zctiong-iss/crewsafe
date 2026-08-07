package com.crewsafe.mitigation.api;

import com.crewsafe.mitigation.domain.AgentDraftPlan;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.UUID;

/**
 * REST API response DTO for agent-generated draft plans.
 * Provides supervisor with AI-generated recommendations for heat mitigation operations.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AgentDraftPlanResponse(
        UUID id,
        UUID siteId,
        UUID supervisorId,
        String planContext,
        String recommendedActions,
        String policyRulesApplied,
        String forecastDataUsed,
        String safetyConsiderations,
        Integer estimatedDurationMinutes,
        String modelId,
        String modelVersion,
        String approvalStatus,
        Instant createdAt,
        Instant updatedAt,
        Instant approvedAt
) {
    /**
     * Create response from entity
     */
    public static AgentDraftPlanResponse fromEntity(AgentDraftPlan entity) {
        return new AgentDraftPlanResponse(
                entity.getId(),
                entity.getSiteId(),
                entity.getSupervisorId(),
                entity.getPlanContext(),
                entity.getRecommendedActions(),
                entity.getPolicyRulesApplied(),
                entity.getForecastDataUsed(),
                entity.getSafetyConsiderations(),
                entity.getEstimatedDurationMinutes(),
                entity.getModelId(),
                entity.getModelVersion(),
                entity.getApprovalStatus().name(),
                entity.getCreatedAt(),
                entity.getUpdatedAt(),
                entity.getApprovedAt()
        );
    }
}
