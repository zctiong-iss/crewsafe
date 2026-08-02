package com.crewsafe.shift.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * One worker's assignment to a {@link Shift}. {@code shiftId} and {@code workerId} are
 * plain UUID columns, not {@code @ManyToOne} associations — see {@link Shift} for why.
 *
 * @author Abu Bakar
 */
@Entity
@Table(name = "shift_assignment")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ShiftAssignment {

    @Id
    private UUID id;

    @Column(name = "shift_id", nullable = false)
    private UUID shiftId;

    @Column(name = "worker_id", nullable = false)
    private UUID workerId;

    @Column(name = "task_name", length = 120)
    private String taskName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Intensity intensity;

    @Column(name = "acclimatisation_day")
    private Integer acclimatisationDay;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public ShiftAssignment(UUID shiftId, UUID workerId, String taskName, Intensity intensity,
                            Integer acclimatisationDay) {
        this.id = UUID.randomUUID();
        this.shiftId = shiftId;
        this.workerId = workerId;
        this.taskName = taskName;
        this.intensity = intensity;
        this.acclimatisationDay = acclimatisationDay;
    }

    /**
     * The only correction path an assignment has (SCRUM-159/160-fix). {@code workerId} is
     * deliberately not settable here — reassigning to a different worker is remove this
     * assignment, add a new one, not an in-place change.
     */
    public void correct(String taskName, Intensity intensity, Integer acclimatisationDay) {
        this.taskName = taskName;
        this.intensity = intensity;
        this.acclimatisationDay = acclimatisationDay;
    }

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
