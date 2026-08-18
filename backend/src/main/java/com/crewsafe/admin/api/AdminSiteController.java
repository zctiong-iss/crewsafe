package com.crewsafe.admin.api;

import com.crewsafe.admin.service.SiteAdminService;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.site.domain.Site;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Admin site CRUD (US-30). Every method is ADMIN-only and unscoped by
 * {@code @siteAccess} — these are system-management actions, not site-scoped reads, so an
 * admin reaches every site here the same way {@link com.crewsafe.identity.security.SiteAccessEvaluator}
 * already lets ADMIN bypass membership everywhere else.
 *
 * @author Jemilin Beulah
 */
@RestController
@RequestMapping("/api/v1/admin/sites")
@RequiredArgsConstructor
public class AdminSiteController {

    private final SiteAdminService siteAdminService;

    public record SiteResponse(UUID id, String name, BigDecimal latitude, BigDecimal longitude,
            String timezone, boolean archived, Instant createdAt) {

        static SiteResponse from(Site site) {
            return new SiteResponse(site.getId(), site.getName(), site.getLatitude(), site.getLongitude(),
                    site.getTimezone(), site.isArchived(), site.getCreatedAt());
        }
    }

    public record SiteWriteRequest(
            @NotBlank @Size(max = 120) String name,
            @NotNull @DecimalMin("-90") @DecimalMax("90") BigDecimal latitude,
            @NotNull @DecimalMin("-180") @DecimalMax("180") BigDecimal longitude) {
    }

    /** Every site, including archived ones — so an admin can find one to unarchive. */
    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<List<SiteResponse>> listSites() {
        return ResponseEntity.ok(siteAdminService.list().stream().map(SiteResponse::from).toList());
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<SiteResponse> createSite(@AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @Valid @RequestBody SiteWriteRequest request) {

        Site saved = siteAdminService.create(request.name(), request.latitude(), request.longitude(),
                principal.getId());
        return ResponseEntity.status(HttpStatus.CREATED).body(SiteResponse.from(saved));
    }

    @PatchMapping("/{siteId}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<SiteResponse> updateSite(@PathVariable UUID siteId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @Valid @RequestBody SiteWriteRequest request) {

        Site saved = siteAdminService.update(siteId, request.name(), request.latitude(), request.longitude(),
                principal.getId());
        return ResponseEntity.ok(SiteResponse.from(saved));
    }

    @PostMapping("/{siteId}/archive")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<SiteResponse> archiveSite(@PathVariable UUID siteId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        return ResponseEntity.ok(SiteResponse.from(siteAdminService.archive(siteId, principal.getId())));
    }

    @PostMapping("/{siteId}/unarchive")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<SiteResponse> unarchiveSite(@PathVariable UUID siteId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        return ResponseEntity.ok(SiteResponse.from(siteAdminService.unarchive(siteId, principal.getId())));
    }
}
