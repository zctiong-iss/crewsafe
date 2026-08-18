package com.crewsafe.insights;

import com.crewsafe.operation.domain.ActionDispatch;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The read side of the SCRUM-433 compliance dashboard. Lives in the insights package rather than
 * on {@code ActionDispatchRepository} so the compliance feature adds no method to another team's
 * repository — it only reads their data.
 *
 * <p>Both queries reach a site the same way the action-status stream does: a dispatch has no
 * {@code siteId}, only {@code recommendation.shiftId}, and {@code Shift} carries {@code siteId}
 * as a plain column, so the join is {@code dispatch → recommendation → shift.siteId}.
 *
 * @author Tang Chee Seng
 */
public interface ComplianceQueryRepository extends JpaRepository<ActionDispatch, UUID> {

    /**
     * Every dispatch for a site whose {@code dispatchedAt} falls in {@code [from, to)}. Returned as
     * entities and classified in the service (actedOn vs lapsed vs still-pending) rather than
     * aggregated in SQL, because the day bucket depends on the site's timezone and the outcome
     * partition is business logic worth reading in one place.
     *
     * <p>The {@code , Shift shift} theta-join matches {@code recommendation.shiftId} (a plain UUID
     * column, so not a navigable association) to a shift's id. It goes through {@code recommendation},
     * never {@code approval} — an auto-dispatched stop-work has no approval (SCRUM-440), and joining
     * through approval would silently drop exactly those rows.
     */
    @Query("""
            SELECT ad FROM ActionDispatch ad, Shift shift
            WHERE ad.recommendation.shiftId = shift.id
              AND shift.siteId = :siteId
              AND ad.dispatchedAt >= :from AND ad.dispatchedAt < :to
            """)
    List<ActionDispatch> findDispatchesForSite(@Param("siteId") UUID siteId,
            @Param("from") Instant from, @Param("to") Instant to);

    /**
     * One response time (seconds) per acknowledged dispatch in range: the gap between the dispatch
     * and its acknowledgement. {@code ActionDispatch} stores {@code dispatchedAt} but not an ack
     * timestamp, so the ack time comes from the {@code ACTION_ACKNOWLEDGED} audit event correlated
     * by target ({@code target_id = dispatch id}). {@code MIN(occurred_at)} guards against a dispatch
     * that somehow carries more than one ack event — the first acknowledgement is the response.
     */
    @Query(value = """
            SELECT EXTRACT(EPOCH FROM (MIN(ae.occurred_at) - ad.dispatched_at))
            FROM action_dispatch ad
            JOIN recommendation r ON r.id = ad.recommendation_id
            JOIN shift s ON s.id = r.shift_id
            JOIN audit_event ae ON ae.target_type = 'ACTION_DISPATCH'
                 AND ae.target_id = ad.id
                 AND ae.event_type = 'ACTION_ACKNOWLEDGED'
            WHERE s.site_id = :siteId
              AND ad.dispatched_at >= :from AND ad.dispatched_at < :to
            GROUP BY ad.id, ad.dispatched_at
            """, nativeQuery = true)
    List<Double> findAckResponseSeconds(@Param("siteId") UUID siteId,
            @Param("from") Instant from, @Param("to") Instant to);
}
