package com.crewsafe.policy.service;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.common.error.ResourceNotFoundException;
import com.crewsafe.policy.domain.PolicyVersion;
import com.crewsafe.policy.domain.PolicyVersionStatus;
import com.crewsafe.policy.repository.PolicyVersionRepository;
import com.crewsafe.site.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Configures and versions a site's heat policy (SCRUM-120): the Safety Manager-facing half of
 * the module {@link PolicyEngineService} evaluates against.
 *
 * <p>A version is created as {@link PolicyVersionStatus#DRAFT} unless it is the site's very
 * first — {@link PolicyEngineService} cannot evaluate a site with zero {@code ACTIVE} versions,
 * so a brand-new site's first configured version is activated immediately rather than leaving
 * the site unable to produce a single recommendation until a Safety Manager remembers a second
 * "now activate it" step.
 *
 * @author Jemilin Beulah
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class PolicyVersionService {

    private final PolicyVersionRepository policyVersions;
    private final SiteRepository sites;
    private final AuditService audit;

    /** Every version ever configured for a site, newest effective date first. */
    public List<PolicyVersion> listForSite(UUID siteId) {
        return policyVersions.findBySiteIdOrderByEffectiveDateDescCreatedAtDesc(siteId);
    }

    /** The version currently governing recommendations for a site, if any has been configured. */
    public Optional<PolicyVersion> getActive(UUID siteId) {
        return policyVersions.findBySiteIdAndStatus(siteId, PolicyVersionStatus.ACTIVE);
    }

    /**
     * The version actually governing recommendations for a site right now: its own
     * {@code ACTIVE} version if it has configured one, otherwise the company-wide default
     * (V16, {@code siteId IS NULL}) that {@link PolicyEngineService} falls back to. Unlike
     * {@link #getActive}, this comes back empty only if the default itself were somehow not
     * ACTIVE — V16 seeds it that way permanently, so in practice a caller always gets a
     * result.
     */
    public Optional<PolicyVersion> getEffective(UUID siteId) {
        return policyVersions.findBySiteIdAndStatus(siteId, PolicyVersionStatus.ACTIVE)
                .or(() -> policyVersions.findBySiteIdIsNullAndStatus(PolicyVersionStatus.ACTIVE));
    }

    /**
     * Creates a new policy version for a site from a caller-built draft (id, status and audit
     * timestamps are not yet set — this method owns them). {@code draft.siteId} is overwritten
     * with {@code siteId}, the path parameter that {@code @siteAccess} already authorized,
     * rather than trusting whatever the request body carried.
     *
     * @throws ResourceNotFoundException if no site with this id exists
     * @throws ConflictException if the site already has a version with this label
     * @throws BadRequestException if the thresholds don't satisfy light ≥ moderate ≥ heavy
     *                              for every acclimatisation level
     */
    @Transactional
    public PolicyVersion create(UUID siteId, PolicyVersion draft, UUID actorId) {
        if (!sites.existsById(siteId)) {
            throw new ResourceNotFoundException("No site " + siteId);
        }
        if (policyVersions.existsBySiteIdAndVersionLabel(siteId, draft.getVersionLabel())) {
            throw new ConflictException(
                    "Site " + siteId + " already has a policy version labelled " + draft.getVersionLabel());
        }
        assertThresholdsOrdered(draft);

        draft.setSiteId(siteId);
        draft.setCreatedBy(actorId);

        boolean isFirstForSite = policyVersions.findBySiteIdOrderByEffectiveDateDescCreatedAtDesc(siteId).isEmpty();
        if (isFirstForSite) {
            draft.setStatus(PolicyVersionStatus.ACTIVE);
            draft.setActivatedAt(Instant.now());
        } else {
            draft.setStatus(PolicyVersionStatus.DRAFT);
        }

        PolicyVersion saved = policyVersions.save(draft);

        audit.record(actorId, AuditEventType.POLICY_VERSION_CREATED, "POLICY_VERSION", saved.getId(),
                "Policy version " + saved.getVersionLabel() + " created for site " + siteId
                        + (isFirstForSite ? " (auto-activated: site's first version)" : " as DRAFT"));

        return saved;
    }

    /**
     * Activates a DRAFT version, superseding whichever version was previously {@code ACTIVE}
     * for the site (if any). Activating a version that is already {@code ACTIVE} is a no-op
     * that returns it unchanged — the caller asked for a state that already holds.
     *
     * @throws ResourceNotFoundException if no version with this id exists under this site
     * @throws ConflictException if the version is SUPERSEDED — a terminal state, never reactivated
     */
    @Transactional
    public PolicyVersion activate(UUID siteId, UUID versionId, UUID actorId) {
        PolicyVersion target = policyVersions.findBySiteIdAndId(siteId, versionId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "No policy version " + versionId + " under site " + siteId));

        if (target.getStatus() == PolicyVersionStatus.ACTIVE) {
            return target;
        }
        if (target.getStatus() == PolicyVersionStatus.SUPERSEDED) {
            throw new ConflictException(
                    "Policy version " + versionId + " is SUPERSEDED and cannot be reactivated");
        }

        // saveAndFlush, not save: uq_policy_version_active_per_site is an immediate (not
        // deferred) constraint, so the previous version's UPDATE to SUPERSEDED must actually
        // reach Postgres before the target's UPDATE to ACTIVE is issued below — otherwise
        // Hibernate is free to flush them in either order, and flushing the target first would
        // momentarily leave two ACTIVE rows for this site and fail the constraint.
        policyVersions.findBySiteIdAndStatus(siteId, PolicyVersionStatus.ACTIVE).ifPresent(previous -> {
            previous.setStatus(PolicyVersionStatus.SUPERSEDED);
            previous.setSupersededAt(Instant.now());
            policyVersions.saveAndFlush(previous);
        });

        target.setStatus(PolicyVersionStatus.ACTIVE);
        target.setActivatedAt(Instant.now());
        PolicyVersion saved = policyVersions.save(target);

        audit.record(actorId, AuditEventType.POLICY_VERSION_ACTIVATED, "POLICY_VERSION", saved.getId(),
                "Policy version " + saved.getVersionLabel() + " activated for site " + siteId);

        return saved;
    }

    /**
     * Mirrors {@code chk_intensity_ordering} (V12) in Java so a caller gets a 400 with a clear
     * message instead of a raw {@code DataIntegrityViolationException} from the DB constraint.
     */
    private void assertThresholdsOrdered(PolicyVersion v) {
        boolean ordered =
                gte(v.getWbgtThresholdUnacclimatisedLight(), v.getWbgtThresholdUnacclimatisedModerate())
                        && gte(v.getWbgtThresholdUnacclimatisedModerate(), v.getWbgtThresholdUnacclimatisedHeavy())
                        && gte(v.getWbgtThresholdPartialLight(), v.getWbgtThresholdPartialModerate())
                        && gte(v.getWbgtThresholdPartialModerate(), v.getWbgtThresholdPartialHeavy())
                        && gte(v.getWbgtThresholdFullLight(), v.getWbgtThresholdFullModerate())
                        && gte(v.getWbgtThresholdFullModerate(), v.getWbgtThresholdFullHeavy());

        if (!ordered) {
            throw new BadRequestException(
                    "WBGT thresholds must satisfy light >= moderate >= heavy for every acclimatisation level");
        }
    }

    private static boolean gte(BigDecimal a, BigDecimal b) {
        return a.compareTo(b) >= 0;
    }
}
