package com.crewsafe.policy.domain;

import jakarta.persistence.*;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * JPA entity for one version of a site's heat-rest policy (SCRUM-120).
 *
 * <p>Replaces {@code HeatRestPolicy}, which stored exactly one mutable row per site: a
 * threshold change overwrote the previous configuration with nothing kept of where it came
 * from or when it applied. Every version a Safety Manager configures is kept here instead,
 * each carrying its own {@link #source} and {@link #effectiveDate}; exactly one per site is
 * ever {@link PolicyVersionStatus#ACTIVE} — enforced by {@code
 * uq_policy_version_active_per_site} (V12), not just this class.
 *
 * <p>Thresholds are stored per acclimatisation level + intensity combination, unchanged from
 * {@code HeatRestPolicy}.
 *
 * Reference: ADR-013 (UTC storage, SG display timezone), MOM work-rest guidelines.
 *
 * @author Jemilin Beulah
 */
@Entity
@Table(name = "policy_version")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PolicyVersion {

    @Id
    private UUID id;

    @NotNull
    private UUID siteId;

    /** Human-assigned, traceable identifier, e.g. {@code "MOM-WBGT-2026.2"}. Unique per site. */
    @NotBlank
    private String versionLabel;

    /** Where this version's thresholds came from, e.g. a guideline document or risk assessment. */
    @NotBlank
    private String source;

    /** The date this version's rule is/was in force — distinct from when it was created or activated. */
    @NotNull
    private LocalDate effectiveDate;

    @NotNull
    @Enumerated(EnumType.STRING)
    @Builder.Default
    private PolicyVersionStatus status = PolicyVersionStatus.DRAFT;

    /**
     * WBGT threshold for unacclimatised workers, light intensity work (°C).
     * Default: 25°C per MOM guidelines.
     */
    @NotNull
    @Min(15)
    private BigDecimal wbgtThresholdUnacclimatisedLight;

    /**
     * WBGT threshold for unacclimatised workers, moderate intensity work (°C).
     */
    @NotNull
    @Min(15)
    private BigDecimal wbgtThresholdUnacclimatisedModerate;

    /**
     * WBGT threshold for unacclimatised workers, heavy intensity work (°C).
     */
    @NotNull
    @Min(15)
    private BigDecimal wbgtThresholdUnacclimatisedHeavy;

    /**
     * WBGT threshold for partially acclimatised workers, light intensity (°C).
     * Default: 26°C.
     */
    @NotNull
    @Min(15)
    private BigDecimal wbgtThresholdPartialLight;

    /**
     * WBGT threshold for partially acclimatised workers, moderate intensity (°C).
     */
    @NotNull
    @Min(15)
    private BigDecimal wbgtThresholdPartialModerate;

    /**
     * WBGT threshold for partially acclimatised workers, heavy intensity (°C).
     */
    @NotNull
    @Min(15)
    private BigDecimal wbgtThresholdPartialHeavy;

    /**
     * WBGT threshold for fully acclimatised workers, light intensity (°C).
     * Default: 28°C.
     */
    @NotNull
    @Min(15)
    private BigDecimal wbgtThresholdFullLight;

    /**
     * WBGT threshold for fully acclimatised workers, moderate intensity (°C).
     */
    @NotNull
    @Min(15)
    private BigDecimal wbgtThresholdFullModerate;

    /**
     * WBGT threshold for fully acclimatised workers, heavy intensity (°C).
     */
    @NotNull
    @Min(15)
    private BigDecimal wbgtThresholdFullHeavy;

    /**
     * Emergency stop threshold (°C).
     * Above this, no work permitted regardless of acclimatisation.
     * Default: 33°C per MOM official guidelines (Band 3: WBGT ≥ 33°C).
     * Reference: MOM Heat Stress Management Standards
     */
    @NotNull
    @Min(20)
    private BigDecimal wbgtEmergencyStop;

    private String notes;

    /** The Safety Manager who configured this version. Null for versions carried forward by V12. */
    private UUID createdBy;

    @NotNull
    private Instant createdAt;

    @NotNull
    private Instant updatedAt;

    private Instant activatedAt;

    private Instant supersededAt;

    /**
     * Get WBGT threshold for given acclimatisation level and work intensity.
     *
     * @param level Acclimatisation level
     * @param intensity Work intensity (LIGHT, MODERATE, HEAVY)
     * @return WBGT threshold in °C
     * @throws IllegalArgumentException if intensity is unknown
     */
    public BigDecimal getThreshold(AcclimatisationLevel level, WorkIntensity intensity) {
        return switch (level) {
            case UNACCLIMATISED -> switch (intensity) {
                case LIGHT -> wbgtThresholdUnacclimatisedLight;
                case MODERATE -> wbgtThresholdUnacclimatisedModerate;
                case HEAVY -> wbgtThresholdUnacclimatisedHeavy;
            };
            case PARTIAL -> switch (intensity) {
                case LIGHT -> wbgtThresholdPartialLight;
                case MODERATE -> wbgtThresholdPartialModerate;
                case HEAVY -> wbgtThresholdPartialHeavy;
            };
            case FULL -> switch (intensity) {
                case LIGHT -> wbgtThresholdFullLight;
                case MODERATE -> wbgtThresholdFullModerate;
                case HEAVY -> wbgtThresholdFullHeavy;
            };
        };
    }

    @PrePersist
    protected void onCreate() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (status == null) {
            status = PolicyVersionStatus.DRAFT;
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        updatedAt = Instant.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
