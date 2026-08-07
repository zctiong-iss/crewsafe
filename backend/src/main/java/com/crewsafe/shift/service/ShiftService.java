package com.crewsafe.shift.service;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Create/list/read/correct/delete a shift, and add/correct/remove an assignment on one
 * (SCRUM-160, extended by SCRUM-159/160-fix), implementing {@code docs/api/shift.yaml}.
 *
 * @author Abu Bakar
 * @author Justin Chua
 */
@Service
@RequiredArgsConstructor
public class ShiftService {

    private final ShiftRepository shifts;
    private final ShiftAssignmentRepository assignments;
    private final AuditService audit;
    private final Clock clock;

    public record AssignmentInput(UUID workerId, String taskName, Intensity intensity,
                                   Integer acclimatisationDay) {
    }

    /**
     * {@code assignmentInputs} may be empty — a shift can be created unstaffed and staffed
     * later via {@link #addAssignment}. Emits {@link AuditEventType#SHIFT_CREATED} exactly
     * once per call, regardless of how many assignments were given.
     */
    @Transactional
    public Shift createShift(UUID siteId, UUID actorId, Instant startsAt, Instant endsAt,
                              List<AssignmentInput> assignmentInputs) {
        if (!endsAt.isAfter(startsAt)) {
            throw new BadRequestException("endsAt must be after startsAt");
        }

        Shift shift = shifts.save(new Shift(siteId, startsAt, endsAt));

        for (AssignmentInput input : assignmentInputs) {
            guardAgainstDoubleBooking(input.workerId(), startsAt, endsAt);
            assignments.save(new ShiftAssignment(shift.getId(), input.workerId(), input.taskName(),
                    input.intensity(), input.acclimatisationDay()));
        }

        UUID shiftId = shift.getId();
        afterCommit(() -> audit.record(actorId, AuditEventType.SHIFT_CREATED, "SHIFT", shiftId,
                "Created shift for site " + siteId));

        return shift;
    }


    /**
     * Refuses to edit a shift that is over (SCRUM-266).
     *
     * <p>A {@code PLANNED} shift is freely editable and an {@code ACTIVE} one is editable with the
     * caller's eyes open — the app confirms that separately, because changing a worker's intensity
     * mid-shift changes the heat obligations they are working under. A finished shift is different
     * in kind: editing one rewrites history the audit trail and any downstream report have already
     * recorded, and no correction is worth that.
     *
     * <p>Enforced here rather than only in the app. A rule that lives in one client is a rule every
     * other client ignores, and these endpoints accepted an edit at any status until now.
     *
     * <p>Both conditions are checked because they are not the same thing. {@code CLOSED} is the
     * status somebody set; an {@code endsAt} in the past is a shift that ended whether or not
     * anything got round to closing it.
     */
    private void assertEditable(Shift shift) {
        Instant now = clock.instant();

        if (shift.getStatus() == ShiftStatus.CLOSED) {
            throw new BadRequestException("A closed shift cannot be edited.");
        }
        if (!shift.getEndsAt().isAfter(now)) {
            throw new BadRequestException("A shift that has already ended cannot be edited.");
        }
    }

    /**
     * Data-entry correction of {@code startsAt}/{@code endsAt} only (SCRUM-159/160-fix) —
     * not a status transition, which has no correction path yet. Empty when no shift with
     * this id exists under this site — the caller renders 404.
     */
    @Transactional
    public Optional<Shift> updateShift(UUID siteId, UUID actorId, UUID shiftId, Instant startsAt, Instant endsAt) {
        if (!endsAt.isAfter(startsAt)) {
            throw new BadRequestException("endsAt must be after startsAt");
        }

        return shifts.findByIdAndSiteId(shiftId, siteId).map(shift -> {
            assertEditable(shift);
            shift.correctTimes(startsAt, endsAt);
            afterCommit(() -> audit.record(actorId, AuditEventType.SHIFT_UPDATED, "SHIFT", shiftId,
                    "Corrected shift times for site " + siteId));
            return shift;
        });
    }

    /**
     * Removes the shift and every assignment on it (SCRUM-159/160-fix). Assignments are
     * deleted first: {@code shift_assignment.shift_id} has no {@code ON DELETE CASCADE}, so
     * the shift row cannot be removed while assignments still reference it. Returns
     * {@code false} when no shift with this id exists under this site — the caller renders
     * 404.
     */
    @Transactional
    public boolean deleteShift(UUID siteId, UUID actorId, UUID shiftId) {
        return shifts.findByIdAndSiteId(shiftId, siteId).map(shift -> {
            assignments.deleteByShiftId(shiftId);
            shifts.delete(shift);
            afterCommit(() -> audit.record(actorId, AuditEventType.SHIFT_DELETED, "SHIFT", shiftId,
                    "Deleted shift for site " + siteId));
            return true;
        }).orElse(false);
    }

    /**
     * Corrects an assignment's task/intensity/acclimatisation day (SCRUM-159/160-fix).
     * {@code workerId} is not settable here by design — see {@link
     * ShiftAssignment#correct}. Empty when no shift with this id exists under this site, or
     * no assignment with this id exists on that shift; the caller renders 404 either way,
     * the same as {@link #addAssignment}'s 404.
     */
    @Transactional
    public Optional<Shift> updateAssignment(UUID siteId, UUID actorId, UUID shiftId, UUID assignmentId,
                                             String taskName, Intensity intensity, Integer acclimatisationDay) {
        return shifts.findByIdAndSiteId(shiftId, siteId).flatMap(shift -> {
            assertEditable(shift);
            return assignments.findByIdAndShiftId(assignmentId, shiftId).map(assignment -> {
                assignment.correct(taskName, intensity, acclimatisationDay);
                afterCommit(() -> audit.record(actorId, AuditEventType.SHIFT_ASSIGNMENT_UPDATED,
                        "SHIFT_ASSIGNMENT", assignmentId, "Corrected assignment on shift " + shiftId));
                return shift;
            });
        });
    }

    /**
     * Takes a worker off a shift (SCRUM-159/160-fix). Returns {@code false} when no shift
     * with this id exists under this site, or no assignment with this id exists on that
     * shift — the caller renders 404 either way.
     */
    @Transactional
    public boolean removeAssignment(UUID siteId, UUID actorId, UUID shiftId, UUID assignmentId) {
        Optional<Shift> shift = shifts.findByIdAndSiteId(shiftId, siteId);
        if (shift.isEmpty()) {
            return false;
        }
        assertEditable(shift.get());

        return assignments.findByIdAndShiftId(assignmentId, shiftId).map(assignment -> {
            assignments.delete(assignment);
            afterCommit(() -> audit.record(actorId, AuditEventType.SHIFT_ASSIGNMENT_REMOVED,
                    "SHIFT_ASSIGNMENT", assignmentId, "Removed assignment from shift " + shiftId));
            return true;
        }).orElse(false);
    }

    /**
     * {@link AuditService#record} runs in {@code REQUIRES_NEW}, so an inline call would
     * commit the audit row immediately, independent of the caller's own transaction — if the
     * rest of that transaction then failed to persist, the audit event would survive a
     * rollback and falsely claim work that never happened. Every audit write in this class
     * goes through here instead, deferred until the transaction actually commits.
     */
    private void afterCommit(Runnable action) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                action.run();
            }
        });
    }

    public List<Shift> listShifts(UUID siteId) {
        return shifts.findBySiteIdOrderByCreatedAtDescIdDesc(siteId);
    }

    /** Batch-fetched so listing N shifts costs one assignments query, not N. */
    public Map<UUID, List<ShiftAssignment>> assignmentsGroupedByShiftId(List<UUID> shiftIds) {
        return assignments.findByShiftIdIn(shiftIds).stream()
                .collect(Collectors.groupingBy(ShiftAssignment::getShiftId));
    }

    public Optional<Shift> getShift(UUID siteId, UUID shiftId) {
        return shifts.findByIdAndSiteId(shiftId, siteId);
    }

    public List<ShiftAssignment> assignmentsFor(UUID shiftId) {
        return assignments.findByShiftId(shiftId);
    }

    /** Empty when no shift with this id exists under this site — the caller renders 404. */
    @Transactional
    public Optional<Shift> addAssignment(UUID siteId, UUID shiftId, AssignmentInput input) {
        return shifts.findByIdAndSiteId(shiftId, siteId).map(shift -> {
            assertEditable(shift);
            guardAgainstDoubleBooking(input.workerId(), shift.getStartsAt(), shift.getEndsAt());
            assignments.save(new ShiftAssignment(shift.getId(), input.workerId(), input.taskName(),
                    input.intensity(), input.acclimatisationDay()));
            return shift;
        });
    }

    /**
     * SCRUM-254: a worker cannot hold two assignments whose shifts' time ranges overlap —
     * same site or not, same shift or not — this is a domain invariant, not a per-endpoint
     * rule, so both {@link #createShift} and {@link #addAssignment} route through here
     * rather than each re-implementing the check. Assigning the same worker to the same
     * shift twice is caught by this too: the shift's own range trivially overlaps itself
     * once the first assignment exists.
     */
    private void guardAgainstDoubleBooking(UUID workerId, Instant startsAt, Instant endsAt) {
        if (!assignments.findOverlapping(workerId, startsAt, endsAt).isEmpty()) {
            throw new BadRequestException("Worker " + workerId + " already has an overlapping shift assignment");
        }
    }

    /** A shift paired with only the caller's own assignment on it (SCRUM-266). */
    public record MyShift(Shift shift, ShiftAssignment assignment) {
    }

    /**
     * The caller's current or next shift, resolved from their own id (SCRUM-266).
     *
     * <p>Implements {@code docs/api/shift-readiness.yaml}: not site-scoped, and carrying only the
     * caller's own task, intensity and acclimatisation — never the other assignments on the same
     * shift. That is the whole reason this is a separate read rather than reusing the supervisor's
     * shift view, which returns every assignment on the shift by design.
     *
     * <p>Empty when nothing is scheduled. That is an answer, not a failure: the screen has an
     * empty state for it and the endpoint returns 200 with a null shift.
     */
    public Optional<MyShift> myCurrentOrNextShift(UUID workerId) {
        return shifts.findCurrentOrUpcomingForWorker(workerId, clock.instant()).stream()
                .findFirst()
                .flatMap(shift -> assignments.findByShiftIdAndWorkerId(shift.getId(), workerId)
                        .map(assignment -> new MyShift(shift, assignment)));
    }
}
