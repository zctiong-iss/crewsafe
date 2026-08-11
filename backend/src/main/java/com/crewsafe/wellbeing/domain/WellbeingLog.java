package com.crewsafe.wellbeing.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * One rest taken or one drink of water, at a time (US-11).
 *
 * <p>Immutable by construction: there are no setters, and nothing edits a log once written. A
 * worker who rested at 10:40 rested at 10:40, and a record a supervisor uses to judge whether a
 * crew is coping must not be something anyone can quietly revise afterwards.
 *
 * <p>Carries a timestamp and nothing else — no duration, no note. A worker in gloves in direct
 * sun will not fill in a form, and the question the supervisor is actually asking ("has anyone
 * not rested in two hours?") is answered by the timestamp alone. Duration can be added later
 * without changing what is already recorded.
 *
 * @author Justin Chua
 */
@Entity
@Table(name = "wellbeing_log")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class WellbeingLog {

    public enum LogType {
        REST,
        HYDRATION
    }

    /**
     * Whether the worker chose this or was told to do it.
     *
     * <p>Both are real — a crew that rests only when instructed is still resting — but they mean
     * different things about how that crew is coping, and a supervisor who cannot tell them apart
     * cannot see the difference between a crew managing itself and one being managed.
     */
    public enum LogSource {
        SELF,
        INSTRUCTED
    }

    @Id
    private UUID id;

    @Column(name = "shift_id", nullable = false)
    private UUID shiftId;

    @Column(name = "worker_id", nullable = false)
    private UUID workerId;

    @Enumerated(EnumType.STRING)
    @Column(name = "log_type", nullable = false, length = 20)
    private LogType logType;

    @Enumerated(EnumType.STRING)
    @Column(name = "source", nullable = false, length = 20)
    private LogSource source;

    /**
     * The dispatch that produced this, for an {@code INSTRUCTED} log; null for a self-logged one.
     *
     * <p>Unique in the schema, which is what makes completing a dispatch idempotent: a retry on a
     * flaky connection cannot log the same rest twice.
     */
    @Column(name = "dispatch_id")
    private UUID dispatchId;

    @Column(name = "logged_at", nullable = false)
    private Instant loggedAt;

    /** A worker's own log — the button on My shift. */
    public static WellbeingLog self(UUID shiftId, UUID workerId, LogType logType, Instant loggedAt) {
        WellbeingLog log = new WellbeingLog();
        log.id = UUID.randomUUID();
        log.shiftId = shiftId;
        log.workerId = workerId;
        log.logType = logType;
        log.source = LogSource.SELF;
        log.loggedAt = loggedAt;
        return log;
    }

    /** A rest that was dispatched, acknowledged, and run to completion. */
    public static WellbeingLog instructedRest(UUID shiftId, UUID workerId, UUID dispatchId, Instant loggedAt) {
        WellbeingLog log = new WellbeingLog();
        log.id = UUID.randomUUID();
        log.shiftId = shiftId;
        log.workerId = workerId;
        log.logType = LogType.REST;
        log.source = LogSource.INSTRUCTED;
        log.dispatchId = dispatchId;
        log.loggedAt = loggedAt;
        return log;
    }
}
