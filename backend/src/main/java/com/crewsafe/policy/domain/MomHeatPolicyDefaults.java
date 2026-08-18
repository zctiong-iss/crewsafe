package com.crewsafe.policy.domain;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/**
 * The MOM Work-Rest Guideline thresholds every Singapore site starts on (SCRUM-432).
 *
 * <h2>Why a default exists at all</h2>
 *
 * These twelve numbers are national regulation, not a per-site opinion, so requiring each site to
 * re-enter them bought nothing. What it cost was the entire feature: {@code policy_version} was
 * empty on every fresh database, {@link com.crewsafe.policy.service.PolicyEngineService} throws
 * without an ACTIVE version, and the draft endpoint turns that into a 409 — so a site with no
 * policy produced no recommendations, no mandatory rest and no hydration controls at all. Refusing
 * to invent thresholds is right; shipping the published national baseline is not inventing them.
 *
 * <h2>Why this does not contradict §7.1</h2>
 *
 * §7.1 requires thresholds to be <em>configuration records</em> rather than constants compiled into
 * the engine, and a company may legitimately run stricter numbers than MOM. Both still hold: what
 * this class seeds is a real {@link PolicyVersion} row, labelled, sourced and dated, that a Safety
 * Manager can supersede with a stricter version through the normal API. The engine still reads
 * whatever version is ACTIVE and still cites its label on every decision — it has no knowledge of
 * this class. {@code createdBy} is null because no person configured it, which is the same
 * convention V12 used for the versions it carried forward.
 *
 * <p><strong>These values are duplicated in {@code V17__seed_default_policy_version.sql}</strong>,
 * because a Flyway migration cannot call Java. {@code MomHeatPolicyDefaultsTest} asserts the two
 * agree, so the copies cannot drift apart silently.
 *
 * @author Abu Bakar
 */
public final class MomHeatPolicyDefaults {

    /**
     * Matches the label V12 carried forward, and the one PolicyEngineService hardcoded before it,
     * so a recommendation issued on a seeded site cites the same version string as one issued on a
     * site whose policy was imported from {@code heat_rest_policy}.
     */
    public static final String VERSION_LABEL = "MOM-WBGT-2026.1";

    public static final String SOURCE = "MOM Work-Rest Guidelines";

    public static final String NOTES =
            "Seeded automatically as the national baseline (SCRUM-432). Supersede this with a "
                    + "site-specific version if this site operates to stricter thresholds.";

    /** Unacclimatised workers — the strictest tier, because they have not yet adapted. */
    public static final BigDecimal UNACCLIMATISED_LIGHT = new BigDecimal("25.0");
    public static final BigDecimal UNACCLIMATISED_MODERATE = new BigDecimal("23.0");
    public static final BigDecimal UNACCLIMATISED_HEAVY = new BigDecimal("21.0");

    /** Partially acclimatised — mid tier. */
    public static final BigDecimal PARTIAL_LIGHT = new BigDecimal("26.0");
    public static final BigDecimal PARTIAL_MODERATE = new BigDecimal("24.0");
    public static final BigDecimal PARTIAL_HEAVY = new BigDecimal("22.0");

    /** Fully acclimatised — the most permissive tier. */
    public static final BigDecimal FULL_LIGHT = new BigDecimal("28.0");
    public static final BigDecimal FULL_MODERATE = new BigDecimal("26.0");
    public static final BigDecimal FULL_HEAVY = new BigDecimal("24.0");

    /**
     * Legacy compatibility value retained in seeded policy versions.
     *
     * @deprecated WBGT no longer creates a STOP_WORK action; lightning owns automatic stop-work.
     */
    @SuppressWarnings("java:S1133") // Legacy seed value remains for persisted policy-version compatibility.
    @Deprecated(since = "2026.08", forRemoval = false)
    public static final BigDecimal EMERGENCY_STOP = new BigDecimal("33.0");

    private MomHeatPolicyDefaults() {
    }

    /**
     * An ACTIVE baseline version for a site that has none.
     *
     * <p>Callers must only use this for a site with no ACTIVE version — {@code
     * uq_policy_version_active_per_site} (V12) enforces one ACTIVE row per site, so activating a
     * second one is a constraint violation rather than a silent overwrite. That is deliberate: a
     * configured policy must never be replaced by the default.
     *
     * @param effectiveDate the date this baseline is treated as being in force from
     */
    public static PolicyVersion activeVersionFor(UUID siteId, LocalDate effectiveDate) {
        return PolicyVersion.builder()
                .id(UUID.randomUUID())
                .siteId(siteId)
                .versionLabel(VERSION_LABEL)
                .source(SOURCE)
                .effectiveDate(effectiveDate)
                .status(PolicyVersionStatus.ACTIVE)
                .wbgtThresholdUnacclimatisedLight(UNACCLIMATISED_LIGHT)
                .wbgtThresholdUnacclimatisedModerate(UNACCLIMATISED_MODERATE)
                .wbgtThresholdUnacclimatisedHeavy(UNACCLIMATISED_HEAVY)
                .wbgtThresholdPartialLight(PARTIAL_LIGHT)
                .wbgtThresholdPartialModerate(PARTIAL_MODERATE)
                .wbgtThresholdPartialHeavy(PARTIAL_HEAVY)
                .wbgtThresholdFullLight(FULL_LIGHT)
                .wbgtThresholdFullModerate(FULL_MODERATE)
                .wbgtThresholdFullHeavy(FULL_HEAVY)
                .wbgtEmergencyStop(EMERGENCY_STOP)
                .notes(NOTES)
                // Null on purpose: nobody configured this, the system provided it. Same convention
                // V12 used for carried-forward versions, and what distinguishes a seeded baseline
                // from one a Safety Manager signed off.
                .createdBy(null)
                .build();
    }
}
