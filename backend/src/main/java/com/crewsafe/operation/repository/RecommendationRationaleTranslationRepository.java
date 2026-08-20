package com.crewsafe.operation.repository;

import com.crewsafe.operation.domain.RecommendationRationaleTranslation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * Lookup for the per-locale rationale cache.
 *
 * @author Justin Chua
 */
public interface RecommendationRationaleTranslationRepository
        extends JpaRepository<RecommendationRationaleTranslation, UUID> {

    Optional<RecommendationRationaleTranslation> findByRecommendationIdAndLocale(
            UUID recommendationId, String locale);
}
