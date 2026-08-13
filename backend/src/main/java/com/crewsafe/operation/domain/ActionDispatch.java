package com.crewsafe.operation.domain;

import com.crewsafe.identity.domain.AppUser;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA entity for action dispatch - represents a specific action dispatched to an individual worker.
 *
 * @author Surya Kumaraguru
 */
@Entity
@Table(name = "action_dispatch")
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
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

    /**
     * Set the first time the ack-window sweep flips this dispatch to {@code LATE}
     * (SCRUM-324). Stays set even after it's later acknowledged or completed — the only
     * place that records it was ever late, since {@link ActionDispatchStatus} itself has
     * no "acknowledged late" value.
     */
    @Column(name = "late_at")
    private Instant lateAt;

    /** Null until {@code COMPLETED}. See {@link CompletionSource}. */
    @Enumerated(EnumType.STRING)
    @Column(name = "completed_by")
    private CompletionSource completedBy;

    public enum ActionDispatchStatus {
        PENDING,
        LATE,
        ACKNOWLEDGED,
        COMPLETED
    }

    /** WORKER for a manual complete tap, SYSTEM for the auto-complete sweep (SCRUM-324). */
    public enum CompletionSource {
        WORKER,
        SYSTEM
    }
}
