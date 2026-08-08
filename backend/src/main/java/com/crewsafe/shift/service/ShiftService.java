package com.crewsafe.shift.service;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Create/list/read/correct/delete a shift, and add/correct/remove an assignment on one
 * (SCRUM-160, extended by SCRUM-159/160-fix), implementing {@code docs/api/shift.yaml}.
 *
 * @author Abu Bakar
 */
@Service
@RequiredArgsConstructor
public class ShiftService {

    private final ShiftRepository shifts;
    private final ShiftAssignmentRepository assignments;
    private final AuditService audit;
    /** Only for the audit trail's display zone — shift logic never reads the site row. */
    private final SiteRepository sites;

    private static final DateTimeFormatter LOCAL_DATE = DateTimeFormatter.ofPattern("d MMM uuuu", Locale.UK);
    private static final DateTimeFormatter LOCAL_TIME = DateTimeFormatter.ofPattern("HH:mm", Locale.UK);

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
        // Resolved now, not inside the lambda: that runs after commit, outside this transaction.
        String detail = "Created shift for site " + siteId + " (" + localRange(siteId, startsAt, endsAt) + ")";
        afterCommit(() -> audit.record(actorId, AuditEventType.SHIFT_CREATED, "SHIFT", shiftId, detail));

        return shift;
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
            shift.correctTimes(startsAt, endsAt);
            String detail = "Corrected shift times for site " + siteId
                    + " to " + localRange(siteId, startsAt, endsAt);
            afterCommit(() -> audit.record(actorId, AuditEventType.SHIFT_UPDATED, "SHIFT", shiftId, detail));
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
        return shifts.findByIdAndSiteId(shiftId, siteId).flatMap(shift ->
                assignments.findByIdAndShiftId(assignmentId, shiftId).map(assignment -> {
                    assignment.correct(taskName, intensity, acclimatisationDay);
                    afterCommit(() -> audit.record(actorId, AuditEventType.SHIFT_ASSIGNMENT_UPDATED,
                            "SHIFT_ASSIGNMENT", assignmentId, "Corrected assignment on shift " + shiftId));
                    return shift;
                }));
    }

    /**
     * Takes a worker off a shift (SCRUM-159/160-fix). Returns {@code false} when no shift
     * with this id exists under this site, or no assignment with this id exists on that
     * shift — the caller renders 404 either way.
     */
    @Transactional
    public boolean removeAssignment(UUID siteId, UUID actorId, UUID shiftId, UUID assignmentId) {
        if (shifts.findByIdAndSiteId(shiftId, siteId).isEmpty()) {
            return false;
        }

        return assignments.findByIdAndShiftId(assignmentId, shiftId).map(assignment -> {
            assignments.delete(assignment);
            afterCommit(() -> audit.record(actorId, AuditEventType.SHIFT_ASSIGNMENT_REMOVED,
                    "SHIFT_ASSIGNMENT", assignmentId, "Removed assignment from shift " + shiftId));
            return true;
        }).orElse(false);
    }

    /**
     * The shift's range on the wall clock of the site it runs at, plus the IANA zone it was
     * read in (ADR-0013, amended).
     *
     * <p>Audit rows are evidence, and evidence has to stand on its own. {@code occurredAt} is
     * a server-side {@code Instant} and needs no help, but a reader asking "what shift was
     * this?" would otherwise have to join back to {@code shift.starts_at} — a column holding
     * instants derived under two different frontend rules, with nothing in the schema marking
     * which. Naming the wall clock and the zone here makes the row answer the question by
     * itself, and keeps it true if CrewSafe ever runs a site outside Singapore. Hence the zone
     * comes from {@link Site#getTimezone()} rather than a constant.
     *
     * <p>An unknown site falls back to UTC and says so, rather than quietly asserting SGT.
     */
    private String localRange(UUID siteId, Instant startsAt, Instant endsAt) {
        ZoneId zone = sites.findById(siteId)
                .map(Site::getTimezone)
                .map(ZoneId::of)
                .orElse(ZoneId.of("UTC"));

        ZonedDateTime start = startsAt.atZone(zone);
        ZonedDateTime end = endsAt.atZone(zone);

        // An overnight shift needs both dates, or "22:00–06:00" reads as running backwards.
        String range = start.toLocalDate().equals(end.toLocalDate())
                ? LOCAL_DATE.format(start) + " " + LOCAL_TIME.format(start) + "–" + LOCAL_TIME.format(end)
                : LOCAL_DATE.format(start) + " " + LOCAL_TIME.format(start) + " – "
                        + LOCAL_DATE.format(end) + " " + LOCAL_TIME.format(end);

        return range + " " + zone.getId();
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
}
