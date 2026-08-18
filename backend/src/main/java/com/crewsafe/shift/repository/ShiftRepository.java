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
     * The upcoming board for the SCRUM-437 readiness summary: a site's shifts in one of the
     * given statuses (PLANNED/ACTIVE), soonest first. {@code startsAt} orders the board the way
     * a supervisor reads it — next shift at the top; {@code id} is a deterministic tiebreaker
     * for same-instant starts, the same reason {@link #findBySiteIdOrderByCreatedAtDescIdDesc}
     * carries one. CLOSED/CANCELLED shifts are excluded by not being passed in the status set.
     */
    List<Shift> findBySiteIdAndStatusInOrderByStartsAtAscIdAsc(
            UUID siteId, java.util.Collection<ShiftStatus> statuses);

    /**
     * Powers the conditions screen's active-shift lookup. {@code findFirst}, not a unique
     * query, since nothing here enforces one ACTIVE shift per site.
     */
    Optional<Shift> findFirstBySiteIdAndStatusOrderByStartsAtDesc(UUID siteId, ShiftStatus status);

    /** Powers the SCRUM-441 activation sweep: shifts of a given status whose start time has passed. */
    List<Shift> findByStatusAndStartsAtLessThanEqual(ShiftStatus status, Instant now);

    /**
     * The SCRUM-291 auto-trigger's shift-state guard: {@code status == ACTIVE AND now <
     * endsAt}, or {@code status == PLANNED AND now >= startsAt - leadWindow} -- expressed here
     * as {@code startsAt <= leadWindowCutoff} where the caller passes {@code now + leadWindow},
     * since JPQL has no interval-subtraction operator. {@code endsAt > now} on the ACTIVE arm
     * matters because SCRUM-441 deliberately never auto-transitions a shift out of ACTIVE when
     * it ends -- without this check, a shift that ended and was never closed would stay
     * ACTIVE, and therefore in scope for auto-trigger, indefinitely. CANCELLED and CLOSED are
     * excluded by construction: neither status appears in either arm.
     */
    @Query("""
            SELECT shift FROM Shift shift
            WHERE shift.siteId = :siteId
              AND (
                  (shift.status = com.crewsafe.shift.domain.ShiftStatus.ACTIVE AND shift.endsAt > :now)
                  OR (shift.status = com.crewsafe.shift.domain.ShiftStatus.PLANNED
                      AND shift.startsAt <= :leadWindowCutoff)
              )
            ORDER BY shift.startsAt ASC, shift.id ASC
            """)
    List<Shift> findEligibleForAutoTrigger(@Param("siteId") UUID siteId, @Param("now") Instant now,
            @Param("leadWindowCutoff") Instant leadWindowCutoff);

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
