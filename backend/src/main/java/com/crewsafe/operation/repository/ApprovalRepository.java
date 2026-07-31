package com.crewsafe.operation.repository;

import com.crewsafe.operation.domain.Approval;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Repository for Approval persistence operations.
 *
 * @author Surya Kumaraguru
 */
@Repository
public interface ApprovalRepository extends JpaRepository<Approval, UUID> {
    Optional<Approval> findByRecommendationId(UUID recommendationId);
}
