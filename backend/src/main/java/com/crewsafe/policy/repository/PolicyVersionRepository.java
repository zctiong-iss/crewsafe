package com.crewsafe.policy.repository;

import com.crewsafe.policy.domain.PolicyVersion;
import com.crewsafe.policy.domain.PolicyVersionStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for the versioned heat-rest policy catalogue (SCRUM-120).
 *
 * Replaces {@code PolicyConfigRepository}, which looked up a site's single mutable policy
 * row. A site can now have many {@link PolicyVersion} rows; these queries either resolve the
 * one that is currently {@link PolicyVersionStatus#ACTIVE} (what {@code PolicyEngineService}
 * evaluates against) or list the whole catalogue for a site (what a Safety Manager's
 * configuration screen shows).
 *
 * @author Jemilin Beulah
 */
@Repository
public interface PolicyVersionRepository extends JpaRepository<PolicyVersion, UUID> {

    /**
     * The version currently in force for a site. At most one can exist per site — enforced
     * by {@code uq_policy_version_active_per_site} (V12).
     */
    Optional<PolicyVersion> findBySiteIdAndStatus(UUID siteId, PolicyVersionStatus status);

    boolean existsBySiteIdAndStatus(UUID siteId, PolicyVersionStatus status);

    /** Every version ever configured for a site — newest effective date first — for the catalogue view. */
    List<PolicyVersion> findBySiteIdOrderByEffectiveDateDescCreatedAtDesc(UUID siteId);

    boolean existsBySiteIdAndVersionLabel(UUID siteId, String versionLabel);

    Optional<PolicyVersion> findBySiteIdAndId(UUID siteId, UUID id);
}
