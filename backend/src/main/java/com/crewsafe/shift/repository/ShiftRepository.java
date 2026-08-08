package com.crewsafe.shift.repository;

import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * @author Abu Bakar
 */
public interface ShiftRepository extends JpaRepository<Shift, UUID> {

    /**
     * {@code id} is a tiebreaker only, not a meaningful secondary order — two shifts can
     * share a {@code createdAt} (same-millisecond creates), and without a deterministic
     * tiebreaker the DB is free to return those rows in either order, making "most recently
     * created first" flaky.
     */
    List<Shift> findBySiteIdOrderByCreatedAtDescIdDesc(UUID siteId);

    /** Scopes a shift lookup to its site, so a shift id from another site reads as 404. */
    Optional<Shift> findByIdAndSiteId(UUID id, UUID siteId);

    /**
     * Powers the conditions screen's active-shift lookup. {@code findFirst}, not a unique
     * query, since nothing here enforces one ACTIVE shift per site.
     */
    Optional<Shift> findFirstBySiteIdAndStatusOrderByStartsAtDesc(UUID siteId, ShiftStatus status);

    @Query("""
            SELECT shift FROM Shift shift
            WHERE shift.startsAt <= :now AND shift.endsAt > :now
              AND EXISTS (
                  SELECT assignment.id FROM ShiftAssignment assignment
                  WHERE assignment.shiftId = shift.id AND assignment.workerId = :workerId
              )
            ORDER BY shift.startsAt DESC, shift.id ASC
            """)
    List<Shift> findCurrentForWorker(@Param("workerId") UUID workerId,
            @Param("now") Instant now, org.springframework.data.domain.Pageable pageable);

    @Query("""
            SELECT shift FROM Shift shift
            WHERE shift.startsAt > :now
              AND EXISTS (
                  SELECT assignment.id FROM ShiftAssignment assignment
                  WHERE assignment.shiftId = shift.id AND assignment.workerId = :workerId
              )
            ORDER BY shift.startsAt ASC, shift.id ASC
            """)
    List<Shift> findUpcomingForWorker(@Param("workerId") UUID workerId,
            @Param("now") Instant now, org.springframework.data.domain.Pageable pageable);
}
