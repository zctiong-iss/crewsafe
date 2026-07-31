package com.crewsafe.operation.domain;

import com.crewsafe.identity.domain.AppUser;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA entity for action dispatch - represents a specific action dispatched to an individual worker.
 *
 * @author Surya Kumaraguru
 */
@Entity
@Table(name = "action_dispatch")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ActionDispatch {
    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "approval_id", nullable = false)
    private Approval approval;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "worker_id", nullable = false)
    private AppUser worker;

    @Column(name = "action_code", nullable = false, length = 100)
    private String actionCode;

    @Column(name = "instruction")
    private String instruction;

    @Column(name = "start_time")
    private Instant startTime;

    @Column(name = "end_time")
    private Instant endTime;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private ActionDispatchStatus status;

    @Column(name = "dispatched_at", nullable = false)
    private Instant dispatchedAt;

    public enum ActionDispatchStatus {
        PENDING,
        ACKNOWLEDGED,
        COMPLETED
    }
}
