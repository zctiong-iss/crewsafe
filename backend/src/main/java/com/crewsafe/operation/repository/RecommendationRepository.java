package com.crewsafe.operation.repository;

import com.crewsafe.operation.domain.Recommendation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for Recommendation persistence operations.
 *
 * @author Surya Kumaraguru and Abu Bakar
 */
@Repository
public interface RecommendationRepository extends JpaRepository<Recommendation, UUID> {
    List<Recommendation> findByShiftId(UUID shiftId);

    /** Scopes a recommendation lookup to its shift, so an id from another shift reads as 404. */
    Optional<Recommendation> findByIdAndShiftId(UUID id, UUID shiftId);

    /**
     * Powers the SCRUM-291 auto-trigger's dedup guard. {@code findFirst}, not a unique query --
     * nothing before this ticket enforced at most one open {@code PENDING_APPROVAL} per shift,
     * so a pre-existing shift could in principle carry more than one; ordering by
     * {@code createdAt} descending means only the newest is ever superseded, which is the one
     * a supervisor would actually be looking at.
     */
    Optional<Recommendation> findFirstByShiftIdAndStatusOrderByCreatedAtDesc(
            UUID shiftId, Recommendation.RecommendationStatus status);
}
