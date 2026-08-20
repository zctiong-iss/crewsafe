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
 * @author Justin Chua
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ActionDispatchResponse {
    private UUID id;
    private UUID recommendationId;
    /** Null for a stop-work dispatched automatically with no supervisor decision (SCRUM-440). */
    private UUID approvalId;
    private UUID workerId;
    private String actionCode;
    private String instruction;
    /**
     * Translatable key for {@link #instruction}; null means render the text verbatim.
     *
     * <p>Null for pre-V25 rows and for any code with no canned sentence. Clients must treat it
     * as optional -- a worker seeing English is recoverable, a worker seeing a raw key is not.
     */
    private String instructionCode;
    private Instant startTime;
    private Instant endTime;
    private String status;
    private Instant dispatchedAt;
    /** Set the first time the ack-window sweep flips this to LATE (SCRUM-324). */
    private Instant lateAt;
    /** Null until COMPLETED: WORKER for a manual tap, SYSTEM for the auto-complete sweep. */
    private String completedBy;

    public static ActionDispatchResponse fromEntity(ActionDispatch dispatch) {
        return ActionDispatchResponse.builder()
                .id(dispatch.getId())
                .recommendationId(dispatch.getRecommendation().getId())
                .approvalId(dispatch.getApproval() == null ? null : dispatch.getApproval().getId())
                .workerId(dispatch.getWorker().getId())
                .actionCode(dispatch.getActionCode())
                .instruction(dispatch.getInstruction())
                .instructionCode(dispatch.getInstructionCode())
                .startTime(dispatch.getStartTime())
                .endTime(dispatch.getEndTime())
                .status(dispatch.getStatus().name())
                .dispatchedAt(dispatch.getDispatchedAt())
                .lateAt(dispatch.getLateAt())
                .completedBy(dispatch.getCompletedBy() == null ? null : dispatch.getCompletedBy().name())
                .build();
    }
}
