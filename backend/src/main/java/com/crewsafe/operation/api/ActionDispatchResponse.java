package com.crewsafe.operation.api;

import com.crewsafe.operation.domain.ActionDispatch;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * Response DTO for action dispatch endpoints.
 *
 * @author Surya Kumaraguru
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ActionDispatchResponse {
    private UUID id;
    private UUID approvalId;
    private UUID workerId;
    private String actionCode;
    private String instruction;
    private Instant startTime;
    private Instant endTime;
    private String status;
    private Instant dispatchedAt;

    public static ActionDispatchResponse fromEntity(ActionDispatch dispatch) {
        return ActionDispatchResponse.builder()
                .id(dispatch.getId())
                .approvalId(dispatch.getApproval().getId())
                .workerId(dispatch.getWorker().getId())
                .actionCode(dispatch.getActionCode())
                .instruction(dispatch.getInstruction())
                .startTime(dispatch.getStartTime())
                .endTime(dispatch.getEndTime())
                .status(dispatch.getStatus().name())
                .dispatchedAt(dispatch.getDispatchedAt())
                .build();
    }
}
