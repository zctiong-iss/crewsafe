package com.crewsafe.wellbeing.service;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.domain.SymptomFlag;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.wellbeing.domain.Concern;
import com.crewsafe.wellbeing.domain.WellbeingLog;
import com.crewsafe.wellbeing.repository.ConcernRepository;
import com.crewsafe.wellbeing.repository.WellbeingLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Clock;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * What a worker reports about how they are coping, and what a supervisor sees of it (US-11).
 *
 * <p>Two kinds of thing, deliberately kept apart. A {@link WellbeingLog} is a fact with no state
 * — it happened. A {@link Concern} has a life, because "has anyone seen this?" is a question that
 * needs an answer.
 *
 * <p><strong>A worker can only report about themselves.</strong> Every write here resolves the
 * shift from the caller's own assignment rather than trusting a worker id in the request. There
 * is no field for one worker to log rest on another's behalf, which is a stronger guarantee than
 * checking one — the same reasoning {@code WorkerShiftController} uses for {@code /shifts/me}.
 *
 * @author Justin Chua
 */
@Service
@RequiredArgsConstructor
public class WellbeingService {

    private final WellbeingLogRepository logs;
    private final ConcernRepository concerns;
    private final ShiftRepository shifts;
    private final ShiftAssignmentRepository assignments;
    private final AuditService audit;
    private final Clock clock;

    /* ------------------------------- worker writes ------------------------------- */

    /**
     * Logs a rest or a drink for the calling worker on the shift they are actually on.
     *
     * <p>Refuses when the caller has no assignment on that shift. Not merely tidiness: without it
     * a worker could log rest against a crew they have nothing to do with, and a supervisor would
     * read a wellbeing picture of people who were never there.
     */
    @Transactional
    public WellbeingLog log(UUID shiftId, UUID workerId, WellbeingLog.LogType logType) {
        assertOnShift(shiftId, workerId);

        WellbeingLog saved = logs.save(WellbeingLog.self(shiftId, workerId, logType, clock.instant()));

        UUID id = saved.getId();
        afterCommit(() -> audit.recordEvent(workerId, AuditEventType.WELLBEING_LOGGED, "WELLBEING_LOG", id,
                logType.name() + " logged on shift " + shiftId));

        return saved;
    }

    /**
     * Records a completed dispatched rest as a rest that actually happened (US-11).
     *
     * <p>Called after a dispatch is completed, not instead of it. A supervisor asking "has this
     * crew rested?" should not have to know that some rests live in the dispatch table and others
     * in the log — so an instructed rest lands in the same timeline as a self-logged one, tagged
     * so the difference stays visible.
     *
     * <p>Silently does nothing for a dispatch already logged. Completing twice is a retry on a bad
     * connection, not a second rest, and the unique constraint on {@code dispatch_id} is the
     * backstop if two arrive at once.
     */
    @Transactional
    public void recordInstructedRest(UUID shiftId, UUID workerId, UUID dispatchId) {
        if (logs.existsByDispatchId(dispatchId)) {
            return;
        }
        logs.save(WellbeingLog.instructedRest(shiftId, workerId, dispatchId, clock.instant()));
    }

    /**
     * Raises a concern. At least one symptom or a note is required — an empty concern says
     * nothing a supervisor can act on, and would still cost them the trip to look at it.
     */
    @Transactional
    public Concern raiseConcern(UUID shiftId, UUID workerId, Set<SymptomFlag> symptoms, String note) {
        assertOnShift(shiftId, workerId);

        boolean hasSymptom = symptoms != null && !symptoms.isEmpty()
                && !(symptoms.size() == 1 && symptoms.contains(SymptomFlag.NONE));
        boolean hasNote = note != null && !note.isBlank();
        if (!hasSymptom && !hasNote) {
            throw new BadRequestException("A concern needs at least one symptom or a note");
        }

        Concern saved = concerns.save(
                Concern.raise(shiftId, workerId, symptoms == null ? Set.of() : symptoms, note, clock.instant()));

        UUID id = saved.getId();
        afterCommit(() -> audit.recordEvent(workerId, AuditEventType.CONCERN_RAISED, "CONCERN", id,
                "Concern raised on shift " + shiftId));

        return saved;
    }

    /* ---------------------------- supervisor reads/writes ---------------------------- */

    /** Empty when no shift with this id exists under this site — the caller renders 404. */
    public Optional<List<WellbeingLog>> logsForShift(UUID siteId, UUID shiftId) {
        if (shifts.findByIdAndSiteId(shiftId, siteId).isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(logs.findByShiftIdOrderByLoggedAtDescIdDesc(shiftId));
    }

    /** Every concern raised on any shift at this site, newest first. */
    public List<Concern> concernsForSite(UUID siteId) {
        List<UUID> shiftIds = shifts.findBySiteIdOrderByCreatedAtDescIdDesc(siteId).stream()
                .map(Shift::getId)
                .toList();
        if (shiftIds.isEmpty()) {
            return List.of();
        }
        return concerns.findByShiftIdInOrderByRaisedAtDescIdDesc(shiftIds);
    }

    /**
     * Records that a supervisor has seen a concern.
     *
     * <p>A second acknowledgement is a 409 rather than an overwrite: the useful fact is who got
     * there first, and quietly replacing them would erase the only evidence that anyone did.
     *
     * <p>Empty when the concern does not exist on a shift belonging to this site — 404, and
     * deliberately indistinguishable from "no such concern", so a concern id cannot be used to
     * probe which sites exist.
     */
    @Transactional
    public Optional<Concern> acknowledgeConcern(UUID siteId, UUID concernId, UUID supervisorId) {
        return concerns.findById(concernId)
                .filter(concern -> shifts.findByIdAndSiteId(concern.getShiftId(), siteId).isPresent())
                .map(concern -> {
                    if (concern.getStatus() == Concern.ConcernStatus.ACKNOWLEDGED) {
                        throw new ConflictException("Concern " + concernId + " is already acknowledged");
                    }
                    concern.acknowledge(supervisorId, clock.instant());

                    afterCommit(() -> audit.recordEvent(supervisorId, AuditEventType.CONCERN_ACKNOWLEDGED,
                            "CONCERN", concernId, "Concern acknowledged"));
                    return concern;
                });
    }

    /* ---------------------------------- internals ---------------------------------- */

    private void assertOnShift(UUID shiftId, UUID workerId) {
        boolean assigned = assignments.findByShiftId(shiftId).stream()
                .map(ShiftAssignment::getWorkerId)
                .anyMatch(workerId::equals);

        if (!assigned) {
            throw new BadRequestException("You are not assigned to this shift");
        }
    }

    /**
     * {@link AuditService#recordEvent} runs in {@code REQUIRES_NEW}, so an inline call would commit the
     * audit row independently of this transaction — an audit trail claiming a rest that rolled
     * back. Deferred until commit, same pattern and same reason as {@code ShiftService}.
     */
    private void afterCommit(Runnable action) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                action.run();
            }
        });
    }
}
