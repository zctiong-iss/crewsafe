package com.crewsafe.operation.repository;

import com.crewsafe.operation.domain.ActionDispatch;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Repository for ActionDispatch persistence operations.
 *
 * @author Surya Kumaraguru
 */
@Repository
public interface ActionDispatchRepository extends JpaRepository<ActionDispatch, UUID> {

    @Query("SELECT ad FROM ActionDispatch ad WHERE ad.approval.id = :approvalId")
    List<ActionDispatch> findByApprovalId(@Param("approvalId") UUID approvalId);

    @Query("SELECT ad FROM ActionDispatch ad WHERE ad.worker.id = :workerId AND ad.status = 'PENDING'")
    List<ActionDispatch> findPendingByWorkerId(@Param("workerId") UUID workerId);

    @Query("SELECT ad FROM ActionDispatch ad WHERE ad.approval.id = :approvalId AND ad.worker.id = :workerId")
    List<ActionDispatch> findByApprovalIdAndWorkerId(@Param("approvalId") UUID approvalId, @Param("workerId") UUID workerId);

    /** Ack-window sweep candidates (SCRUM-324): still PENDING past the cutoff. */
    @Query("SELECT ad FROM ActionDispatch ad WHERE ad.status = 'PENDING' AND ad.dispatchedAt <= :cutoff")
    List<ActionDispatch> findPendingDispatchedBefore(@Param("cutoff") Instant cutoff);

    /** Auto-complete sweep candidates (SCRUM-324): still ACKNOWLEDGED past the cutoff. */
    @Query("SELECT ad FROM ActionDispatch ad WHERE ad.status = 'ACKNOWLEDGED' AND ad.startTime <= :cutoff")
    List<ActionDispatch> findAcknowledgedStartedBefore(@Param("cutoff") Instant cutoff);

    /**
     * Powers the SCRUM-324 site action-status stream. {@code shiftId} reaches this
     * entity via {@code recommendation.shiftId} (Recommendation carries it as a plain UUID
     * column, same as {@link com.crewsafe.shift.domain.Shift}), so callers resolve a site's
     * active shift first (see ActionStatusSnapshotService) rather than this repository
     * knowing about siteId directly.
     *
     * <p>Goes through {@code recommendation}, not {@code approval} (SCRUM-440): an
     * auto-dispatched stop-work has no approval at all, and {@code approval.recommendation}
     * would have been an implicit inner join silently hiding those rows from this stream --
     * the one place they most need to be visible.
     */
    @Query("SELECT ad FROM ActionDispatch ad WHERE ad.recommendation.shiftId = :shiftId ORDER BY ad.dispatchedAt DESC")
    List<ActionDispatch> findByShiftId(@Param("shiftId") UUID shiftId);

    /** Every dispatch fanned out from one recommendation, for cancelling them on supersede. */
    @Query("SELECT ad FROM ActionDispatch ad WHERE ad.recommendation.id = :recommendationId")
    List<ActionDispatch> findByRecommendationId(@Param("recommendationId") UUID recommendationId);
}
