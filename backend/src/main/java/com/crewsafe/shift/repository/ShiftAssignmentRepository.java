package com.crewsafe.shift.repository;

import com.crewsafe.shift.domain.ShiftAssignment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * @author Abu Bakar
 */
public interface ShiftAssignmentRepository extends JpaRepository<ShiftAssignment, UUID> {

    List<ShiftAssignment> findByShiftId(UUID shiftId);

    /** Batch fetch for listing shifts, so rendering N shifts does not cost N queries. */
    List<ShiftAssignment> findByShiftIdIn(List<UUID> shiftIds);
}
