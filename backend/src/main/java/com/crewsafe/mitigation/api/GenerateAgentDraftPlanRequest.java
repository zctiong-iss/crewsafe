package com.crewsafe.mitigation.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * Request DTO to generate an agent draft plan.
 * Supervisor submits context about site conditions and operations.
 */
public record GenerateAgentDraftPlanRequest(
        @NotNull(message = "siteId is required")
        UUID siteId,

        @NotBlank(message = "planContext is required")
        String planContext
) {
}
