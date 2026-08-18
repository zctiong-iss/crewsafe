package com.crewsafe.identity.repository;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.UserStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * @author Jemilin Beulah and Abu Bakar
 */
public interface AppUserRepository extends JpaRepository<AppUser, UUID> {

    Optional<AppUser> findByUsername(String username);

    Optional<AppUser> findByCognitoSub(String cognitoSub);

    boolean existsByUsername(String username);

    boolean existsByCognitoSub(String cognitoSub);

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

    /** One site's users of a role, paired with the site, for a many-site read. */
    interface SiteUser {
        UUID getSiteId();

        UUID getUserId();

        String getDisplayName();
    }

    /**
     * The same lookup as {@link #findBySiteIdAndRoleAndStatus} across many sites at once.
     *
     * <p>Exists for the oversight list, which needs every site's supervisors to label plans. Per
     * site that would be one query each, and a manager may hold twenty memberships — the whole
     * point of the summary endpoint this feeds is that it costs one round trip rather than
     * twenty.
     *
     * <p>Ordered by site then name so the pills render in a stable order: a list that reshuffles
     * between refreshes moves a name under someone's thumb.
     */
    @Query("select m.siteId as siteId, u.id as userId, u.displayName as displayName "
            + "from AppUser u, SiteMembership m "
            + "where m.userId = u.id and m.siteId in :siteIds "
            + "and u.role = :role and u.status = :status "
            + "order by m.siteId, u.displayName")
    List<SiteUser> findBySiteIdsAndRoleAndStatus(
            @Param("siteIds") Collection<UUID> siteIds,
            @Param("role") Role role,
            @Param("status") UserStatus status);
}
