package com.crewsafe.identity.repository;

import com.crewsafe.identity.domain.SiteMembership;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.UUID;

public interface SiteMembershipRepository extends JpaRepository<SiteMembership, UUID> {

    /**
     * The FR-03 check. Called on every site-scoped request, so it must stay a single
     * indexed lookup — see idx_site_membership_user in V1__baseline_identity.sql.
     */
    boolean existsByUserIdAndSiteId(UUID userId, UUID siteId);

    @Query("select m.siteId from SiteMembership m where m.userId = :userId")
    List<UUID> findSiteIdsByUserId(UUID userId);
}
