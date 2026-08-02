package com.crewsafe.identity.repository;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.UserStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * @author Jemilin Beulah
 */
public interface AppUserRepository extends JpaRepository<AppUser, UUID> {

    Optional<AppUser> findByUsername(String username);

    Optional<AppUser> findByCognitoSub(String cognitoSub);

    /**
     * The mirror of {@link com.crewsafe.identity.repository.SiteMembershipRepository
     * #findSiteIdsByUserId} — site to users instead of user to sites. Filters to role and
     * status server-side rather than in Java: a picker of assignment candidates has no use
     * for a supervisor or an offboarded worker, so there is no reason to ship those rows at
     * all. Uses idx_site_membership_site (V1__baseline_identity.sql) for the subquery.
     */
    @Query("select u from AppUser u where u.role = :role and u.status = :status "
            + "and u.id in (select m.userId from SiteMembership m where m.siteId = :siteId) "
            + "order by u.displayName")
    List<AppUser> findBySiteIdAndRoleAndStatus(
            @Param("siteId") UUID siteId, @Param("role") Role role, @Param("status") UserStatus status);
}
