package com.crewsafe.shift.repository;

import com.crewsafe.shift.domain.ShiftAssignment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * @author Abu Bakar
 * @author Justin Chua
 */
public interface ShiftAssignmentRepository extends JpaRepository<ShiftAssignment, UUID> {

    List<ShiftAssignment> findByShiftId(UUID shiftId);

    /** Batch fetch for listing shifts, so rendering N shifts does not cost N queries. */
    List<ShiftAssignment> findByShiftIdIn(List<UUID> shiftIds);

    /** Scopes an assignment lookup to its shift, so an assignment id from another shift
     * reads as 404 rather than silently updating/removing the wrong shift's row. */
    Optional<ShiftAssignment> findByIdAndShiftId(UUID id, UUID shiftId);

    /** Finds the caller's own assignment without exposing another worker's details. */
    Optional<ShiftAssignment> findByShiftIdAndWorkerId(UUID shiftId, UUID workerId);

    /** Used to clear a shift's assignments before the shift itself is deleted — the
     * shift_assignment.shift_id foreign key has no ON DELETE CASCADE. */
    void deleteByShiftId(UUID shiftId);

    /**
     * SCRUM-254: powers the double-booking guard in {@code ShiftService}. {@code
     * ShiftAssignment} has no JPA association to {@code Shift} (see {@link
     * com.crewsafe.shift.domain.Shift}'s class doc — plain UUID columns by design), so this
     * follows the same subquery idiom already used for the equivalent plain-UUID-linked
     * lookup in {@code AppUserRepository.findBySiteIdAndRoleAndStatus}, rather than an
     * explicit join. {@code [startsAt, endsAt)} half-open, matching the boundary
     * {@code ShiftService} already uses for {@code endsAt > startsAt}: a shift ending
     * exactly when another starts does not count as an overlap.
     */
    @Query("select sa from ShiftAssignment sa where sa.workerId = :workerId and sa.shiftId in "
            + "(select s.id from Shift s where s.startsAt < :endsAt and s.endsAt > :startsAt)")
    List<ShiftAssignment> findOverlapping(@Param("workerId") UUID workerId, @Param("startsAt") Instant startsAt,
                                           @Param("endsAt") Instant endsAt);
}
