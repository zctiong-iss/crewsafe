package com.crewsafe.shift.service;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Create/list/read a shift and add an assignment to one (SCRUM-160, implementing
 * {@code docs/api/shift.yaml}).
 *
 * @author Abu Bakar
 */
@Service
@RequiredArgsConstructor
public class ShiftService {

    private final ShiftRepository shifts;
    private final ShiftAssignmentRepository assignments;
    private final AuditService audit;

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
            assignments.save(new ShiftAssignment(shift.getId(), input.workerId(), input.taskName(),
                    input.intensity(), input.acclimatisationDay()));
        }

        audit.record(actorId, AuditEventType.SHIFT_CREATED, "SHIFT", shift.getId(),
                "Created shift for site " + siteId);

        return shift;
    }

    public List<Shift> listShifts(UUID siteId) {
        return shifts.findBySiteIdOrderByCreatedAtDesc(siteId);
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
            assignments.save(new ShiftAssignment(shift.getId(), input.workerId(), input.taskName(),
                    input.intensity(), input.acclimatisationDay()));
            return shift;
        });
    }
}
