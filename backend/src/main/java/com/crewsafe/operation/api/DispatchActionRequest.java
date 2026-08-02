package com.crewsafe.operation.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * Request DTO for dispatching an action to a specific worker.
 *
 * @author Surya Kumaraguru
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DispatchActionRequest {
    @NotNull(message = "Approval ID is required")
    private UUID approvalId;

    @NotNull(message = "Worker ID is required")
    private UUID workerId;

    @NotBlank(message = "Action code is required")
    private String actionCode;

    private String instruction;
}
