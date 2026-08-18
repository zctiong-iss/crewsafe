package com.crewsafe.policy.api;

import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.policy.domain.PolicyVersion;
import com.crewsafe.policy.service.PolicyVersionService;
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
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Heat policy version endpoints (SCRUM-120) — lets a Safety Manager configure and version the
 * active heat policy, with its source and effective date, so every {@code PolicyDecision} that
 * {@link com.crewsafe.policy.service.PolicyEngineService} emits can be traced back to the rule
 * version in force at the time.
 *
 * <p>Site-scoped the same way {@link com.crewsafe.shift.api.ShiftController} is:
 * {@code @siteAccess.canAccess(#siteId)} on every method. Reading the catalogue is open to
 * SUPERVISOR/SAFETY_MANAGER/ADMIN, the same role group {@code SiteController}'s dashboard uses
 * — a worker has no use for site-wide policy thresholds. Creating or activating a version is
 * narrower still: SAFETY_MANAGER/ADMIN only, since a supervisor plans shifts within a policy,
 * they don't set it.
 *
 * <p>Every "not found" throws {@link ResourceNotFoundException} rather than a bare 404
 * (SCRUM-263), matching every other controller in this codebase.
 *
 * @author Jemilin Beulah
 */
@RestController
@RequestMapping("/api/v1/sites/{siteId}/policy-versions")
@RequiredArgsConstructor
public class PolicyVersionController {

    private final PolicyVersionService policyVersionService;

    public record PolicyVersionResponse(
            UUID id, UUID siteId, String versionLabel, String source, LocalDate effectiveDate, String status,
            BigDecimal wbgtThresholdUnacclimatisedLight, BigDecimal wbgtThresholdUnacclimatisedModerate,
            BigDecimal wbgtThresholdUnacclimatisedHeavy,
            BigDecimal wbgtThresholdPartialLight, BigDecimal wbgtThresholdPartialModerate,
            BigDecimal wbgtThresholdPartialHeavy,
            BigDecimal wbgtThresholdFullLight, BigDecimal wbgtThresholdFullModerate,
            BigDecimal wbgtThresholdFullHeavy,
            BigDecimal wbgtEmergencyStop, String notes, UUID createdBy,
            Instant createdAt, Instant updatedAt, Instant activatedAt, Instant supersededAt) {

        /** @deprecated retained for compatibility; ignored by policy enforcement. */
        @SuppressWarnings("java:S1133") // Retained API field pending the compatibility-removal release.
        @Deprecated(since = "2026.08", forRemoval = false)
        @Override
        public BigDecimal wbgtEmergencyStop() {
            return wbgtEmergencyStop;
        }

        static PolicyVersionResponse from(PolicyVersion v) {
            return new PolicyVersionResponse(
                    v.getId(), v.getSiteId(), v.getVersionLabel(), v.getSource(), v.getEffectiveDate(),
                    v.getStatus().name(),
                    v.getWbgtThresholdUnacclimatisedLight(), v.getWbgtThresholdUnacclimatisedModerate(),
                    v.getWbgtThresholdUnacclimatisedHeavy(),
                    v.getWbgtThresholdPartialLight(), v.getWbgtThresholdPartialModerate(),
                    v.getWbgtThresholdPartialHeavy(),
                    v.getWbgtThresholdFullLight(), v.getWbgtThresholdFullModerate(), v.getWbgtThresholdFullHeavy(),
                    v.getWbgtEmergencyStop(), v.getNotes(), v.getCreatedBy(),
                    v.getCreatedAt(), v.getUpdatedAt(), v.getActivatedAt(), v.getSupersededAt());
        }
    }

    public record PolicyVersionCreateRequest(
            @NotBlank @Size(max = 64) String versionLabel,
            @NotBlank @Size(max = 255) String source,
            @NotNull LocalDate effectiveDate,
            @NotNull @DecimalMin("15") BigDecimal wbgtThresholdUnacclimatisedLight,
            @NotNull @DecimalMin("15") BigDecimal wbgtThresholdUnacclimatisedModerate,
            @NotNull @DecimalMin("15") BigDecimal wbgtThresholdUnacclimatisedHeavy,
            @NotNull @DecimalMin("15") BigDecimal wbgtThresholdPartialLight,
            @NotNull @DecimalMin("15") BigDecimal wbgtThresholdPartialModerate,
            @NotNull @DecimalMin("15") BigDecimal wbgtThresholdPartialHeavy,
            @NotNull @DecimalMin("15") BigDecimal wbgtThresholdFullLight,
            @NotNull @DecimalMin("15") BigDecimal wbgtThresholdFullModerate,
            @NotNull @DecimalMin("15") BigDecimal wbgtThresholdFullHeavy,
            @NotNull @DecimalMin("20") @DecimalMax("40") BigDecimal wbgtEmergencyStop,
            String notes) {

        /** @deprecated retained for compatibility; ignored by policy enforcement. */
        @SuppressWarnings("java:S1133") // Retained API field pending the compatibility-removal release.
        @Deprecated(since = "2026.08", forRemoval = false)
        @Override
        public BigDecimal wbgtEmergencyStop() {
            return wbgtEmergencyStop;
        }

        PolicyVersion toDraft() {
            return PolicyVersion.builder()
                    .versionLabel(versionLabel())
                    .source(source())
                    .effectiveDate(effectiveDate())
                    .wbgtThresholdUnacclimatisedLight(wbgtThresholdUnacclimatisedLight())
                    .wbgtThresholdUnacclimatisedModerate(wbgtThresholdUnacclimatisedModerate())
                    .wbgtThresholdUnacclimatisedHeavy(wbgtThresholdUnacclimatisedHeavy())
                    .wbgtThresholdPartialLight(wbgtThresholdPartialLight())
                    .wbgtThresholdPartialModerate(wbgtThresholdPartialModerate())
                    .wbgtThresholdPartialHeavy(wbgtThresholdPartialHeavy())
                    .wbgtThresholdFullLight(wbgtThresholdFullLight())
                    .wbgtThresholdFullModerate(wbgtThresholdFullModerate())
                    .wbgtThresholdFullHeavy(wbgtThresholdFullHeavy())
                    .wbgtEmergencyStop(wbgtEmergencyStop())
                    .notes(notes())
                    .build();
        }
    }

    /** The full version history for a site, newest effective date first. */
    @GetMapping
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<List<PolicyVersionResponse>> listVersions(@PathVariable UUID siteId) {
        return ResponseEntity.ok(policyVersionService.listForSite(siteId).stream()
                .map(PolicyVersionResponse::from)
                .toList());
    }

    /** The version currently governing recommendations for this site. */
    @GetMapping("/active")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<PolicyVersionResponse> getActiveVersion(@PathVariable UUID siteId) {
        PolicyVersion active = policyVersionService.getActive(siteId)
                .orElseThrow(() -> new ResourceNotFoundException("No active policy version for site " + siteId));

        return ResponseEntity.ok(PolicyVersionResponse.from(active));
    }

    /**
     * The version actually governing recommendations for this site right now — its own if it
     * has configured one, otherwise the company-wide default {@link
     * com.crewsafe.policy.service.PolicyEngineService} falls back to. A default response has
     * {@code siteId: null} and is not editable through this API: there is no
     * create/activate target for it, unlike {@link #getActiveVersion}, which stays strictly
     * site-scoped and 404s when the site has configured nothing of its own.
     */
    @GetMapping("/effective")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<PolicyVersionResponse> getEffectiveVersion(@PathVariable UUID siteId) {
        PolicyVersion effective = policyVersionService.getEffective(siteId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "No policy configured for site " + siteId + " and no company default is active"));

        return ResponseEntity.ok(PolicyVersionResponse.from(effective));
    }

    /**
     * Configures a new policy version. Becomes the site's active policy immediately if it is
     * the site's first version ever configured; otherwise it is created as a DRAFT that a
     * subsequent {@link #activateVersion} call puts into force.
     */
    @PostMapping
    @PreAuthorize("hasAnyRole('SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<PolicyVersionResponse> createVersion(@PathVariable UUID siteId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @Valid @RequestBody PolicyVersionCreateRequest request) {

        PolicyVersion saved = policyVersionService.create(siteId, request.toDraft(), principal.getId());
        return ResponseEntity.status(HttpStatus.CREATED).body(PolicyVersionResponse.from(saved));
    }

    /** Activates a DRAFT version, superseding whatever version was previously active. */
    @PostMapping("/{versionId}/activate")
    @PreAuthorize("hasAnyRole('SAFETY_MANAGER', 'ADMIN') and @siteAccess.canAccess(#siteId)")
    public ResponseEntity<PolicyVersionResponse> activateVersion(@PathVariable UUID siteId,
            @PathVariable UUID versionId, @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        PolicyVersion activated = policyVersionService.activate(siteId, versionId, principal.getId());
        return ResponseEntity.ok(PolicyVersionResponse.from(activated));
    }
}
