package com.crewsafe.policy.domain;

import java.util.Objects;

/**
 * Immutable result of policy evaluation.
 *
 * Contains the recommended action based on WBGT, intensity, and acclimatisation level.
 * This is a value object (record) to enforce immutability.
 */
public record PolicyDecision(
    Action action,
    RestRecommendation restRecommendation,
    String reasoning
) {
    /**
     * Enum of possible policy actions.
     */
    public enum Action {
        /**
         * Worker can continue work without rest.
         * WBGT low, acclimatisation adequate, intensity manageable.
         */
        CONTINUE,

        /**
         * Worker must take a short rest (5-10 min).
         * WBGT moderate, increased risk.
         */
        SHORT_REST,

        /**
         * Worker must take extended rest (15-30 min) + hydration.
         * WBGT high, significant heat stress.
         */
        EXTENDED_REST,

        /**
         * Worker must stop work immediately.
         * WBGT critical, imminent heat illness risk.
         */
        STOP_WORK
    }

    public PolicyDecision {
        Objects.requireNonNull(action, "action must not be null");
        Objects.requireNonNull(restRecommendation, "restRecommendation must not be null");
        Objects.requireNonNull(reasoning, "reasoning must not be null");
    }

    /**
     * Check if action requires rest.
     */
    public boolean requiresRest() {
        return action != Action.CONTINUE;
    }

    /**
     * Check if action is emergency stop.
     */
    public boolean isEmergencyStop() {
        return action == Action.STOP_WORK;
    }

    @Override
    public String toString() {
        return "PolicyDecision{" +
                "action=" + action +
                ", restRecommendation=" + restRecommendation +
                ", reasoning='" + reasoning + '\'' +
                '}';
    }
}
