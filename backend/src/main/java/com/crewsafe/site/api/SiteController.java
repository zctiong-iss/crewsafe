package com.crewsafe.site.api;

import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Site endpoints.
 *
 * These exist mainly to demonstrate and test the two layers of authorization the rest of
 * the system will rely on. The weather, shift and recommendation endpoints follow exactly
 * this shape.
 */
@RestController
@RequestMapping("/api/v1/sites")
@RequiredArgsConstructor
public class SiteController {

    private final SiteRepository sites;

    public record SiteResponse(UUID id, String name, BigDecimal latitude, BigDecimal longitude, String timezone) {
        static SiteResponse from(Site site) {
            return new SiteResponse(site.getId(), site.getName(),
                    site.getLatitude(), site.getLongitude(), site.getTimezone());
        }
    }

    public record SiteDashboardResponse(UUID siteId, String name, String status) {
    }

    /**
     * Row-level authorization only: any authenticated role may read a site, but only one
     * they are assigned to.
     */
    @GetMapping("/{siteId}")
    @PreAuthorize("@siteAccess.canAccess(#siteId)")
    public ResponseEntity<SiteResponse> getSite(@PathVariable UUID siteId) {
        return sites.findById(siteId)
                .map(SiteResponse::from)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
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
        return sites.findById(siteId)
                .map(site -> ResponseEntity.ok(new SiteDashboardResponse(site.getId(), site.getName(), "OK")))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
