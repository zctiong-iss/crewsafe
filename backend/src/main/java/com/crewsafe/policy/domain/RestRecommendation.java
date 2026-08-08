package com.crewsafe.policy.domain;

import java.util.Objects;

/**
 * Immutable rest break recommendation details.
 *
 * Specifies duration, shade requirement, hydration guidance, and intensity adjustment.
 * All values are guidelines; actual implementation may vary by site.
 */
public record RestRecommendation(
    int durationMinutes,
    boolean requiresShade,
    String hydrationGuidance,
    String intensityAdjustment
) {
    /**
     * No rest required.
     */
    public static final RestRecommendation NONE = new RestRecommendation(
        0,
        false,
        "Maintain hydration; drink water regularly",
        "No change"
    );

    /**
     * Short rest break.
     */
    public static final RestRecommendation SHORT = new RestRecommendation(
        10,
        true,
        "Drink 0.5-1 litre water, consume electrolyte beverage",
        "Reduce intensity by 20%"
    );

    /**
     * Extended rest break.
     */
    public static final RestRecommendation EXTENDED = new RestRecommendation(
        30,
        true,
        "Drink 1-2 litres water, consume isotonic drink, eat light snack",
        "Reduce intensity by 50%"
    );

    /**
     * Emergency stop - worker must cease work.
     */
    public static final RestRecommendation EMERGENCY = new RestRecommendation(
        Integer.MAX_VALUE,
        true,
        "Cease work immediately. Drink water. Cool with wet towels if necessary.",
        "STOP WORK"
    );

    public RestRecommendation {
        if (durationMinutes < 0) {
            throw new IllegalArgumentException("Duration must be >= 0, got " + durationMinutes);
        }
        Objects.requireNonNull(hydrationGuidance, "hydrationGuidance must not be null");
        Objects.requireNonNull(intensityAdjustment, "intensityAdjustment must not be null");
    }

    /**
     * Check if rest is required.
     */
    public boolean isRestRequired() {
        return durationMinutes > 0;
    }

    /**
     * Check if this is an emergency stop recommendation.
     */
    public boolean isEmergency() {
        return durationMinutes == Integer.MAX_VALUE;
    }

    @Override
    public String toString() {
        return "RestRecommendation{" +
                "durationMinutes=" + durationMinutes +
                ", requiresShade=" + requiresShade +
                ", hydrationGuidance='" + hydrationGuidance + '\'' +
                ", intensityAdjustment='" + intensityAdjustment + '\'' +
                '}';
    }
}
