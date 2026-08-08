package com.crewsafe.policy.domain;

import jakarta.persistence.*;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * JPA entity storing site-specific heat-rest policy thresholds.
 *
 * Each site may have different WBGT thresholds based on:
 * - MOM (Ministry of Manpower) guidelines
 * - Site risk assessment
 * - Industry standards
 *
 * Thresholds are stored per acclimatisation level + intensity combination.
 *
 * Reference: ADR-002 (heat safety strategy), MOM work-rest guidelines.
 */
@Entity
@Table(name = "heat_rest_policy")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class HeatRestPolicy {

    @Id
    private UUID id;

    @NotNull
    private UUID siteId;

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

    @NotNull
    private Instant createdAt;

    @NotNull
    private Instant updatedAt;

    private String notes;

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

    /**
     * Work intensity enum.
     */
    public enum WorkIntensity {
        LIGHT,
        MODERATE,
        HEAVY
    }

    @PrePersist
    protected void onCreate() {
        if (id == null) {
            id = UUID.randomUUID();
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
