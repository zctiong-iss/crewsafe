package com.crewsafe.admin.service;

import com.crewsafe.admin.cognito.CognitoUserProvisioningService;
import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.common.error.ErrorCode;
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
 * Admin-only local user management (US-30): registering a local {@code app_user} row, either
 * bound to a Cognito identity that already exists (a {@code cognitoSub} the admin has —
 * Console, or the SCRUM-190 CI pipeline for synthetic identities) or provisioned fresh
 * (an {@code email}, handed to {@link CognitoUserProvisioningService} to create for real) —
 * then managing role/status/site-membership from there.
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
    private final CognitoUserProvisioningService cognitoProvisioning;

    /** Every user, display-name sorted. */
    public List<AppUser> list() {
        return users.findAll().stream()
                .sorted(Comparator.comparing(AppUser::getDisplayName))
                .toList();
    }

    /**
     * Exactly one of {@code cognitoSub}/{@code email} is expected. On the email path, the
     * admin doesn't invent a separate username at all — {@code username} is ignored and the
     * local {@code app_user.username} is set to {@code email} directly, since username's only
     * remaining job is a unique local handle (auth resolves purely by {@code cognitoSub}; see
     * {@link com.crewsafe.identity.security.CognitoJwtAuthenticationConverter}) and asking for
     * a second identifier for the same person is friction with no payoff. {@code username} is
     * required, and used as-is, on the {@code cognitoSub} path — there's no email to derive it
     * from there. {@code password} is required with {@code email} (the admin sets it directly
     * — ADR 0018) and ignored with {@code cognitoSub}.
     *
     * <p>Every local check runs before {@link CognitoUserProvisioningService} creates the
     * Cognito identity, so a doomed request (bad username, bad site) fails before that
     * external, non-transactional call ever happens rather than after. Cognito isn't part of
     * the Postgres transaction below: if {@code users.save} somehow still fails after a
     * successful {@code AdminCreateUser} call, the Cognito identity is orphaned but
     * recoverable — an admin can register it later via the {@code cognitoSub} path.
     *
     * @throws BadRequestException if neither or both of {@code cognitoSub}/{@code email} are
     *                             given, {@code cognitoSub} is given without a {@code username},
     *                             {@code email} is given without a {@code password}, or (via
     *                             {@code CognitoUserProvisioningService}) the password doesn't
     *                             meet the pool's policy
     * @throws ConflictException with {@link ErrorCode#USERNAME_ALREADY_REGISTERED} if the
     *                           resolved username (the email itself, on that path) is taken,
     *                           plainly if the cognitoSub is already registered, or (via
     *                           {@code CognitoUserProvisioningService}) Cognito provisioning
     *                           isn't enabled yet or already has an identity under this email
     * @throws ResourceNotFoundException if any requested site doesn't exist
     */
    @Transactional
    public AppUser register(String username, String cognitoSub, String email, String password, String displayName,
            Role role, Set<UUID> siteIds, UUID actorId) {

        if ((cognitoSub == null) == (email == null)) {
            throw new BadRequestException("Exactly one of cognitoSub or email must be provided");
        }
        if (email != null && (password == null || password.isBlank())) {
            throw new BadRequestException("A password is required when registering by email");
        }
        if (cognitoSub != null && (username == null || username.isBlank())) {
            throw new BadRequestException("A username is required when binding an existing Cognito identity");
        }

        String resolvedUsername = email != null ? email : username;

        if (users.existsByUsername(resolvedUsername)) {
            throw new ConflictException("Username " + resolvedUsername + " is already registered",
                    ErrorCode.USERNAME_ALREADY_REGISTERED);
        }
        if (cognitoSub != null && users.existsByCognitoSub(cognitoSub)) {
            throw new ConflictException("This Cognito identity is already registered");
        }
        for (UUID siteId : siteIds) {
            if (!sites.existsById(siteId)) {
                throw new ResourceNotFoundException("No site " + siteId);
            }
        }

        String resolvedSub = cognitoSub != null ? cognitoSub : cognitoProvisioning.createUser(email, password, actorId);

        AppUser draft = new AppUser(resolvedUsername, resolvedSub, displayName, role);
        draft.setEmail(email);
        AppUser saved = users.save(draft);
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
