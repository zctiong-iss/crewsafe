package com.crewsafe.mitigation.repository;

import com.crewsafe.mitigation.domain.AgentDraftPlan;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Repository for AgentDraftPlan entities.
 * Manages persistence of AI-generated draft plans.
 */
@Repository
public interface AgentDraftPlanRepository extends JpaRepository<AgentDraftPlan, UUID> {
    /**
     * Find all draft plans for a specific site
     */
    List<AgentDraftPlan> findBySiteId(UUID siteId);

    /**
     * Find all draft plans for a specific supervisor
     */
    List<AgentDraftPlan> findBySupervisorId(UUID supervisorId);

    /**
     * Find pending draft plans for a supervisor at a specific site
     */
    List<AgentDraftPlan> findBySiteIdAndSupervisorIdAndApprovalStatus(
            UUID siteId,
            UUID supervisorId,
            AgentDraftPlan.ApprovalStatus status
    );
}
