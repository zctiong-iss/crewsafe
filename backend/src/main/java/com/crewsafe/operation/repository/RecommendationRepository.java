package com.crewsafe.operation.repository;

import com.crewsafe.operation.domain.Recommendation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Repository for Recommendation persistence operations.
 *
 * @author Surya Kumaraguru
 */
@Repository
public interface RecommendationRepository extends JpaRepository<Recommendation, UUID> {
    List<Recommendation> findByShiftId(UUID shiftId);
}
