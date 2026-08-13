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
     * entity only via {@code approval.recommendation.shiftId} (Recommendation carries it
     * as a plain UUID column, same as {@link com.crewsafe.shift.domain.Shift}), so callers
     * resolve a site's active shift first (see ActionStatusSnapshotService) rather than
     * this repository knowing about siteId directly.
     */
    @Query("SELECT ad FROM ActionDispatch ad WHERE ad.approval.recommendation.shiftId = :shiftId ORDER BY ad.dispatchedAt DESC")
    List<ActionDispatch> findByShiftId(@Param("shiftId") UUID shiftId);
}
