package com.crewsafe.identity.security;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Object-level authorization: may the current user touch this site? (FR-03)
 *
 * <p>Registered as the bean name {@code siteAccess} so it can be referenced from an
 * annotation:
 *
 * <pre>{@code @PreAuthorize("@siteAccess.canAccess(#siteId)")}</pre>
 *
 * <p>Roles answer "what kind of thing may this user do"; this answers "on which rows".
 * A supervisor is a supervisor everywhere, but only at their own sites — no role check can
 * express that, because the answer depends on data.
 *
 * <p><strong>Only ADMIN bypasses membership.</strong> Acceptance test AT-13 requires an
 * "unauthorized manager" requesting another site to be denied, so SAFETY_MANAGER is
 * deliberately *not* exempt — a manager reaches multiple sites by being granted membership
 * of each, which keeps the grant visible and auditable in the database rather than implied
 * by their role. ADMIN is exempt because administration is about managing the system
 * itself, not reading site operations.
 *
 * @author Jemilin Beulah
 */
@Component("siteAccess")
@RequiredArgsConstructor
@Slf4j
public class SiteAccessEvaluator {

    private final SiteMembershipRepository memberships;
    private final AuditService audit;

    public boolean canAccess(UUID siteId) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();

        if (authentication == null
                || !(authentication.getPrincipal() instanceof CrewSafeUserPrincipal principal)) {
            return false;
        }

        if (siteId == null) {
            return false;
        }

        if (principal.getRole() == Role.ADMIN) {
            return true;
        }

        boolean permitted = memberships.existsByUserIdAndSiteId(principal.getId(), siteId);

        if (!permitted) {
            // A denied cross-site attempt is a security event, not just a 403 (FR-04).
            audit.recordEvent(principal.getId(), AuditEventType.ACCESS_DENIED, "SITE", siteId,
                    "Attempted access to a site the user is not assigned to");
            log.warn("site_access_denied");
        }

        return permitted;
    }
}
