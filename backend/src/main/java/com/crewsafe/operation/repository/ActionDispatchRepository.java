package com.crewsafe.operation.repository;

import com.crewsafe.operation.domain.ActionDispatch;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

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
}
