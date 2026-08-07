package com.crewsafe.site.api;

import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.UserStatus;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * Site endpoints.
 *
 * These exist mainly to demonstrate and test the two layers of authorization the rest of
 * the system will rely on. The weather, shift and recommendation endpoints follow exactly
 * this shape.
 *
 * @author Jemilin Beulah and Abu Bakar
 */
@RestController
@RequestMapping("/api/v1/sites")
@RequiredArgsConstructor
public class SiteController {

    private final SiteRepository sites;
    private final SiteMembershipRepository memberships;
    private final AppUserRepository users;

    public record SiteResponse(UUID id, String name, BigDecimal latitude, BigDecimal longitude, String timezone) {
        static SiteResponse from(Site site) {
            return new SiteResponse(site.getId(), site.getName(),
                    site.getLatitude(), site.getLongitude(), site.getTimezone());
        }
    }

    public record SiteDashboardResponse(UUID siteId, String name, String status) {
    }

    public record SiteWorkerResponse(UUID id, String displayName) {
        static SiteWorkerResponse from(AppUser user) {
            return new SiteWorkerResponse(user.getId(), user.getDisplayName());
        }
    }

    /**
     * The sites this user may reach — what the web app's site switcher is built from.
     *
     * <p>Filtered rather than authorized: there is no {@code @PreAuthorize} here because
     * there is no single site to check. The membership join *is* the authorization, which
     * makes this the one place the FR-03 rule is expressed as a filter instead of a guard.
     * The two must not drift, so ADMIN is exempt here exactly as it is in
     * {@link com.crewsafe.identity.security.SiteAccessEvaluator} — and SAFETY_MANAGER is
     * deliberately not, for the reason documented there.
     *
     * <p>Returning an empty list is a legitimate answer, not an error: a new starter with no
     * memberships yet is correctly authenticated and correctly sees nothing.
     */
    @GetMapping
    public ResponseEntity<List<SiteResponse>> listAccessibleSites(
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        List<Site> visible = principal.getRole() == Role.ADMIN
                ? sites.findAll()
                : sites.findAllById(memberships.findSiteIdsByUserId(principal.getId()));

        return ResponseEntity.ok(visible.stream()
                .sorted(Comparator.comparing(Site::getName))
                .map(SiteResponse::from)
                .toList());
    }

    /**
     * Row-level authorization only: any authenticated role may read a site, but only one
     * they are assigned to.
     */
    @GetMapping("/{siteId}")
    @PreAuthorize("@siteAccess.canAccess(#siteId)")
    public ResponseEntity<SiteResponse> getSite(@PathVariable UUID siteId) {
        Site site = sites.findById(siteId)
                .orElseThrow(() -> new ResourceNotFoundException("No site " + siteId));

        return ResponseEntity.ok(SiteResponse.from(site));
    }

    /**
     * Both layers at once: the right kind of user (role) *and* the right site (membership).
     *
     * Workers are excluded because the operations board is a supervisor tool; a supervisor
     * from another site is excluded because it is not their crew.
     */
    @GetMapping("/{siteId}/dashboard")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<SiteDashboardResponse> getDashboard(@PathVariable UUID siteId) {
        Site site = sites.findById(siteId)
                .orElseThrow(() -> new ResourceNotFoundException("No site " + siteId));

        return ResponseEntity.ok(new SiteDashboardResponse(site.getId(), site.getName(), "OK"));
    }

    /**
     * Candidates for {@code assignments[].workerId} on the shift-create/staff endpoints
     * (SCRUM-159/160-fix) — a worker picker needs to know who it can offer, and nothing
     * previously returned that. Same role gate as shift creation: this is a supervisor-tool
     * query, not something a worker needs to see about their own site.
     */
    @GetMapping("/{siteId}/workers")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<List<SiteWorkerResponse>> listSiteWorkers(@PathVariable UUID siteId) {
        List<AppUser> workers = users.findBySiteIdAndRoleAndStatus(siteId, Role.WORKER, UserStatus.ACTIVE);
        return ResponseEntity.ok(workers.stream().map(SiteWorkerResponse::from).toList());
    }
}
