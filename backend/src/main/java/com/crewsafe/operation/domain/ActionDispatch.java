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
 * @author Jemilin Beulah
 * @author Justin Chua
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

    /**
     * The recommendation this dispatch fans out from -- always present, unlike
     * {@link #approval}. Added by SCRUM-440 so shift-scoping (see {@code
     * ActionDispatchRepository#findByShiftId}) does not depend on an approval existing:
     * an auto-dispatched stop-work (see {@link #approval}'s javadoc) has none.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "recommendation_id", nullable = false)
    private Recommendation recommendation;

    /**
     * Null for a lightning stop-work dispatched automatically, with no supervisor decision at
     * all (SCRUM-440) -- {@link Recommendation.RecommendationStatus#AUTO_DISPATCHED}. Present
     * for every other dispatch, which always follows a supervisor's {@code APPROVED}/{@code
     * EDITED} decision.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "approval_id")
    private Approval approval;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "worker_id", nullable = false)
    private AppUser worker;

    @Column(name = "action_code", nullable = false, length = 100)
    private String actionCode;

    @Column(name = "instruction")
    private String instruction;

    /**
     * The key a client translates to render {@link #instruction} in the worker's own language.
     *
     * <p>Null for every row written before V25, and for any mitigation whose code has no canned
     * sentence behind it. Null is not a failure -- it means "render the text verbatim", which is
     * how dispatches behaved before this column existed. See
     * {@code mitigation.domain.InstructionCatalogue}.
     */
    @Column(name = "instruction_code", length = 100)
    private String instructionCode;

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
        COMPLETED,

        /**
         * The recommendation this dispatch was fanned out from was superseded before a worker
         * acknowledged it (SCRUM-291's supersede reaching {@code APPROVED}/{@code
         * AUTO_DISPATCHED} plans). Only a still-{@code PENDING} or {@code LATE} dispatch can
         * reach this -- one already {@code ACKNOWLEDGED} is left to run to {@code COMPLETED}
         * instead, see {@code ActionDispatchService#cancelOutstanding}.
         */
        CANCELLED
    }

    /** WORKER for a manual complete tap, SYSTEM for the auto-complete sweep (SCRUM-324). */
    public enum CompletionSource {
        WORKER,
        SYSTEM
    }
}
