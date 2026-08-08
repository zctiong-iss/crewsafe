package com.crewsafe.shift.domain;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

/**
 * One immutable answer to a worker's pre-shift readiness check. A resubmission creates
 * another entity instead of changing this one, preserving the complete history.
 */
@Entity
@Table(name = "readiness_submission")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ReadinessSubmission {

    @Id
    private UUID id;

    @Column(name = "shift_id", nullable = false)
    private UUID shiftId;

    @Column(name = "worker_id", nullable = false)
    private UUID workerId;

    @Column(name = "fit_to_work", nullable = false)
    private boolean fitToWork;

    @Column(name = "adequate_sleep", nullable = false)
    private boolean adequateSleep;

    @Column(name = "adequate_hydration", nullable = false)
    private boolean adequateHydration;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "readiness_submission_symptom",
            joinColumns = @JoinColumn(name = "readiness_submission_id"))
    @Enumerated(EnumType.STRING)
    @Column(name = "symptom", nullable = false, length = 30)
    private Set<SymptomFlag> symptoms = new LinkedHashSet<>();

    @Column(name = "submitted_at", nullable = false)
    private Instant submittedAt;

    public ReadinessSubmission(UUID shiftId, UUID workerId, boolean fitToWork,
            boolean adequateSleep, boolean adequateHydration, Set<SymptomFlag> symptoms) {
        this.id = UUID.randomUUID();
        this.shiftId = shiftId;
        this.workerId = workerId;
        this.fitToWork = fitToWork;
        this.adequateSleep = adequateSleep;
        this.adequateHydration = adequateHydration;
        this.symptoms.addAll(symptoms);
    }

    /** Exposes a read-only copy so callers cannot change a submitted answer. */
    public Set<SymptomFlag> getSymptoms() {
        return Set.copyOf(symptoms);
    }

    @PrePersist
    void onCreate() {
        if (submittedAt == null) {
            submittedAt = Instant.now();
        }
    }
}
