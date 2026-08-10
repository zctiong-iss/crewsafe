package com.crewsafe.policy.domain;

/**
 * Represents a worker's heat acclimatisation level.
 *
 * Acclimatisation is tracked per shift assignment (day 1-7 of site exposure).
 * WBGT thresholds are reduced for unacclimatised workers to prevent heat illness.
 *
 * Reference: MOM work-rest guidelines, WBGT categorization (ADR-013).
 */
public enum AcclimatisationLevel {
    /**
     * Worker's first 1-3 days at the site.
     * Strictest WBGT thresholds apply.
     * Rest breaks required more frequently.
     */
    UNACCLIMATISED(1, 3),

    /**
     * Worker's 4-6 days at the site.
     * Moderate WBGT thresholds.
     * Transitioning to full acclimatisation.
     */
    PARTIAL(4, 6),

    /**
     * Worker's day 7+ at the site.
     * Full acclimatisation achieved.
     * Standard WBGT thresholds apply.
     */
    FULL(7, Integer.MAX_VALUE);

    private final int minDay;
    private final int maxDay;

    AcclimatisationLevel(int minDay, int maxDay) {
        this.minDay = minDay;
        this.maxDay = maxDay;
    }

    /**
     * Get acclimatisation level from shift acclimatisation day (1-based).
     *
     * @param acclimatisationDay 1-based day count (1 = first day, 7+ = full acclimatisation)
     * @return AcclimatisationLevel corresponding to the day
     * @throws IllegalArgumentException if day is &lt; 1
     */
    public static AcclimatisationLevel fromDay(int acclimatisationDay) {
        if (acclimatisationDay < 1) {
            throw new IllegalArgumentException("Acclimatisation day must be >= 1, got " + acclimatisationDay);
        }
        if (acclimatisationDay <= 3) {
            return UNACCLIMATISED;
        } else if (acclimatisationDay <= 6) {
            return PARTIAL;
        } else {
            return FULL;
        }
    }

    public int getMinDay() {
        return minDay;
    }

    public int getMaxDay() {
        return maxDay;
    }
}
