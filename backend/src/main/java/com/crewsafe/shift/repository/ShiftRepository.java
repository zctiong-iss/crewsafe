package com.crewsafe.shift.repository;

import com.crewsafe.shift.domain.Shift;
import org.springframework.data.jpa.repository.JpaRepository;

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
}
