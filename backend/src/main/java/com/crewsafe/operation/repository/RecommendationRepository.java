package com.crewsafe.operation.repository;

import com.crewsafe.operation.domain.Recommendation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for Recommendation persistence operations.
 *
 * @author Surya Kumaraguru, Abu Bakar and Justin Chua
 */
@Repository
public interface RecommendationRepository extends JpaRepository<Recommendation, UUID> {
    List<Recommendation> findByShiftId(UUID shiftId);

    /** One site's plan counts, for the safety manager's oversight list. */
    interface SitePlanCounts {
        UUID getSiteId();

        /** Plans a supervisor has not decided on yet — the only number that asks for action. */
        long getAwaitingDecision();

        long getTotalPlans();
    }

    /**
     * Counts every site's plans in one query, so an oversight list does not have to fetch them
     * to know what is outstanding.
     *
     * <h2>Why this exists</h2>
     *
     * {@code OversightScreen} loads a site's plans only when a manager expands it — necessary,
     * because loading them eagerly costs one shift request plus one recommendation request per
     * shift, per site, which is roughly 120 requests for the twenty sites that screen is built
     * for. The cost of that laziness was that a site nobody had expanded reported zero plans
     * awaiting a decision, which is indistinguishable from a site with genuinely nothing
     * outstanding. A manager scanning the list would pass over a site with a plan pending
     * approval, on a screen whose entire job is making sure that does not happen.
     *
     * <p>Counting server-side resolves both: one query, accurate before anyone touches
     * anything, and the per-site detail stays lazy.
     *
     * <p>Sites with no plans at all are absent from the result rather than present with zero.
     * The caller knows which sites it asked about, and an absent row and a zero row mean the
     * same thing to it.
     */
    @Query("""
            SELECT sh.siteId AS siteId,
                   SUM(CASE WHEN r.status = com.crewsafe.operation.domain.Recommendation.RecommendationStatus.PENDING_APPROVAL
                            THEN 1L ELSE 0L END) AS awaitingDecision,
                   COUNT(r.id) AS totalPlans
            FROM Recommendation r, Shift sh
            WHERE sh.id = r.shiftId AND sh.siteId IN :siteIds
            GROUP BY sh.siteId
            """)
    List<SitePlanCounts> countPlansBySite(@Param("siteIds") Collection<UUID> siteIds);

    /** Scopes a recommendation lookup to its shift, so an id from another shift reads as 404. */
    Optional<Recommendation> findByIdAndShiftId(UUID id, UUID shiftId);

    /**
     * Powers the SCRUM-291 auto-trigger's dedup guard. {@code findFirst}, not a unique query --
     * nothing before this ticket enforced at most one open recommendation per shift, so a
     * pre-existing shift could in principle carry more than one; ordering by {@code createdAt}
     * descending means only the newest is ever superseded, which is the one a supervisor would
     * actually be looking at. Matches any status in the set passed in, so a plan already
     * {@code APPROVED} or {@code AUTO_DISPATCHED} can be superseded too, not only one still
     * {@code PENDING_APPROVAL}.
     */
    Optional<Recommendation> findFirstByShiftIdAndStatusInOrderByCreatedAtDesc(
            UUID shiftId, Collection<Recommendation.RecommendationStatus> statuses);
}
