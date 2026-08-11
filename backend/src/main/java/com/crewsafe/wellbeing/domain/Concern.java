package com.crewsafe.wellbeing.domain;

import com.crewsafe.shift.domain.SymptomFlag;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

/**
 * A worker saying they are struggling (US-11).
 *
 * <p>Unlike a {@link WellbeingLog} this has a life: it is {@code OPEN} until a supervisor
 * acknowledges it. That state exists to answer one question — <em>has anyone actually seen
 * this?</em> — which is the only thing that matters at 2pm on a hot site, and which a
 * stateless feed cannot answer.
 *
 * <p>There is deliberately no {@code RESOLVED}. This app can know that a supervisor read the
 * report; it cannot know whether the worker is now all right, and a status claiming otherwise
 * would be the app asserting something nobody told it.
 *
 * <p>Symptoms reuse {@link SymptomFlag} from the readiness check rather than a parallel list.
 * Those values are already translated in all seven locales, and two competing vocabularies
 * would mean the same worker reporting the same dizziness in two places no report could join.
 *
 * @author Justin Chua
 */
@Entity
@Table(name = "concern")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Concern {

    public enum ConcernStatus {
        OPEN,
        ACKNOWLEDGED
    }

    @Id
    private UUID id;

    @Column(name = "shift_id", nullable = false)
    private UUID shiftId;

    @Column(name = "worker_id", nullable = false)
    private UUID workerId;

    /**
     * Free text, and optional.
     *
     * <p>Optional because the chips carry the meaning that survives translation, and a worker
     * must never be unable to raise a concern for want of a language their supervisor reads.
     * When it is present it is the worker's own words, in their own language — the app shows it
     * as written rather than pretending it can translate it.
     */
    @Column(name = "note")
    private String note;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "concern_symptom", joinColumns = @JoinColumn(name = "concern_id"))
    @Enumerated(EnumType.STRING)
    @Column(name = "symptom", nullable = false, length = 30)
    private Set<SymptomFlag> symptoms = new LinkedHashSet<>();

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private ConcernStatus status;

    @Column(name = "raised_at", nullable = false)
    private Instant raisedAt;

    @Column(name = "acknowledged_at")
    private Instant acknowledgedAt;

    @Column(name = "acknowledged_by")
    private UUID acknowledgedBy;

    public static Concern raise(UUID shiftId, UUID workerId, Set<SymptomFlag> symptoms,
                                 String note, Instant raisedAt) {
        Concern concern = new Concern();
        concern.id = UUID.randomUUID();
        concern.shiftId = shiftId;
        concern.workerId = workerId;
        concern.symptoms = new LinkedHashSet<>(symptoms);
        // Blank and absent are the same thing here; storing "" would make an empty note render
        // as a note the worker never wrote.
        concern.note = (note == null || note.isBlank()) ? null : note.trim();
        concern.status = ConcernStatus.OPEN;
        concern.raisedAt = raisedAt;
        return concern;
    }

    /**
     * Records that a supervisor has seen this.
     *
     * <p>Idempotent by caller contract: the service refuses a second acknowledgement rather than
     * overwriting who saw it first, because "who responded" is the fact worth keeping.
     */
    public void acknowledge(UUID supervisorId, Instant at) {
        this.status = ConcernStatus.ACKNOWLEDGED;
        this.acknowledgedBy = supervisorId;
        this.acknowledgedAt = at;
    }
}
