package com.crewsafe.admin.service;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.domain.UserStatus;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.site.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Admin-only local user management (US-30): registering a local {@code app_user} row for a
 * Cognito identity that already exists, and managing role/status/site-membership from there.
 *
 * <p>This deliberately never talks to Cognito. Registering a user takes a {@code cognitoSub}
 * the admin already has — created however accounts are created today (AWS Console, or the
 * SCRUM-190 CI pipeline for synthetic identities) — and does exactly what {@code
 * DemoDataSeeder.reconcileIdentity} already does for the seeded demo mapping, just
 * admin-triggered instead of JSON-file-triggered. Actually creating the Cognito identity
 * (and emailing an invite) is separate follow-on work — see the plan for this feature.
 *
 * @author Jemilin Beulah
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserAdminService {

    private final AppUserRepository users;
    private final SiteRepository sites;
    private final SiteMembershipRepository memberships;
    private final AuditService audit;

    /** Every user, display-name sorted. */
    public List<AppUser> list() {
        return users.findAll().stream()
                .sorted(Comparator.comparing(AppUser::getDisplayName))
                .toList();
    }

    /**
     * @throws ConflictException if the username or cognitoSub is already registered
     * @throws ResourceNotFoundException if any requested site doesn't exist
     */
    @Transactional
    public AppUser register(String username, String cognitoSub, String displayName, Role role,
            Set<UUID> siteIds, UUID actorId) {

        if (users.existsByUsername(username)) {
            throw new ConflictException("Username " + username + " is already registered");
        }
        if (users.existsByCognitoSub(cognitoSub)) {
            throw new ConflictException("This Cognito identity is already registered");
        }
        for (UUID siteId : siteIds) {
            if (!sites.existsById(siteId)) {
                throw new ResourceNotFoundException("No site " + siteId);
            }
        }

        AppUser saved = users.save(new AppUser(username, cognitoSub, displayName, role));
        siteIds.forEach(siteId -> memberships.save(new SiteMembership(saved.getId(), siteId)));

        audit.record(actorId, AuditEventType.USER_REGISTERED, "USER", saved.getId(),
                "User " + saved.getUsername() + " registered as " + role + " with " + siteIds.size() + " site(s)");

        return saved;
    }

    /**
     * Partial update — only non-null fields are applied. Refuses to let an admin change their
     * own role or status, so an admin can't demote or deactivate themselves into a lockout.
     *
     * @throws ResourceNotFoundException if no user with this id exists
     * @throws BadRequestException if {@code userId} is the acting admin's own id
     */
    @Transactional
    public AppUser updateRoleAndStatus(UUID userId, Role role, UserStatus status, UUID actorId) {
        if (userId.equals(actorId)) {
            throw new BadRequestException("An admin cannot change their own role or status");
        }

        AppUser user = users.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("No user " + userId));

        if (role != null && role != user.getRole()) {
            Role previous = user.getRole();
            user.setRole(role);
            audit.record(actorId, AuditEventType.USER_ROLE_CHANGED, "USER", userId,
                    "Role changed from " + previous + " to " + role);
        }

        if (status != null && status != user.getStatus()) {
            UserStatus previous = user.getStatus();
            user.setStatus(status);
            audit.record(actorId, AuditEventType.USER_STATUS_CHANGED, "USER", userId,
                    "Status changed from " + previous + " to " + status);
        }

        return users.save(user);
    }

    /**
     * @throws ResourceNotFoundException if the user or site doesn't exist
     * @throws ConflictException if the user already has this site
     */
    @Transactional
    public void grantSite(UUID userId, UUID siteId, UUID actorId) {
        if (!users.existsById(userId)) {
            throw new ResourceNotFoundException("No user " + userId);
        }
        if (!sites.existsById(siteId)) {
            throw new ResourceNotFoundException("No site " + siteId);
        }
        if (memberships.existsByUserIdAndSiteId(userId, siteId)) {
            throw new ConflictException("User " + userId + " already has site " + siteId);
        }

        memberships.save(new SiteMembership(userId, siteId));

        audit.record(actorId, AuditEventType.SITE_MEMBERSHIP_GRANTED, "USER", userId,
                "Granted site " + siteId);
    }

    /**
     * @throws ResourceNotFoundException if the user has no membership for this site
     */
    @Transactional
    public void revokeSite(UUID userId, UUID siteId, UUID actorId) {
        SiteMembership membership = memberships.findByUserIdAndSiteId(userId, siteId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "User " + userId + " has no membership for site " + siteId));

        memberships.delete(membership);

        audit.record(actorId, AuditEventType.SITE_MEMBERSHIP_REVOKED, "USER", userId,
                "Revoked site " + siteId);
    }
}
