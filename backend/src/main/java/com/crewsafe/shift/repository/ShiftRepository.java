package com.crewsafe.shift.repository;

import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * @author Abu Bakar
 * @author Justin Chua
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

    /**
     * The caller's current shift, or failing that their soonest upcoming one (SCRUM-266).
     *
     * <p>Ordering by {@code startsAt} over shifts that have not yet ended gives exactly the
     * precedence {@code docs/api/shift-readiness.yaml} asks for: a shift whose window contains
     * now started before any shift that is merely upcoming, so it sorts first without needing a
     * separate "is it running" clause.
     *
     * <p>A list rather than an {@code Optional} because a worker can legitimately be on two
     * shifts that have not ended — the caller takes the first and the ordering decides which.
     */
    @Query("""
            select s from Shift s
            where s.endsAt > :now
              and s.id in (select a.shiftId from ShiftAssignment a where a.workerId = :workerId)
            order by s.startsAt asc
            """)
    List<Shift> findCurrentOrUpcomingForWorker(@Param("workerId") UUID workerId,
                                                @Param("now") Instant now);
}
