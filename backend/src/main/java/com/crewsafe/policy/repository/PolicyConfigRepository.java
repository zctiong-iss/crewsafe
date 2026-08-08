package com.crewsafe.policy.repository;

import com.crewsafe.policy.domain.HeatRestPolicy;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Repository for site-specific heat-rest policy configurations.
 *
 * Provides queries for policy lookup by site, enabling per-site customization
 * of WBGT thresholds and rest break requirements.
 */
@Repository
public interface PolicyConfigRepository extends JpaRepository<HeatRestPolicy, UUID> {

    /**
     * Find the active policy for a given site.
     *
     * @param siteId the site identifier
     * @return Optional containing the policy if found
     */
    Optional<HeatRestPolicy> findBySiteId(UUID siteId);

    /**
     * Check if a policy exists for a given site.
     *
     * @param siteId the site identifier
     * @return true if policy exists, false otherwise
     */
    boolean existsBySiteId(UUID siteId);
}
