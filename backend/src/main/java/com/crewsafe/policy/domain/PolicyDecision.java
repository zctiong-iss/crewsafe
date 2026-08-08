package com.crewsafe.policy.domain;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Immutable result of policy evaluation.
 *
 * Contains the recommended actions based on WBGT, intensity, and acclimatisation level.
 * Aligns with mobile app's PolicyEvaluation type for consistent API contract.
 * This is a value object (record) to enforce immutability.
 */
public record PolicyDecision(
    String policyVersion,
    String currentBand,
    String forecastBand,
    List<PolicyAction> required,
    List<PolicyAction> advised
) {
    /**
     * Represents a single recommended action with its rule source and applicability.
     */
    public record PolicyAction(
        String action,
        String ruleReference,
        List<String> appliesTo,
        String reasoning
    ) {
        public PolicyAction {
            Objects.requireNonNull(action, "action must not be null");
            Objects.requireNonNull(ruleReference, "ruleReference must not be null");
            Objects.requireNonNull(appliesTo, "appliesTo must not be null");
            Objects.requireNonNull(reasoning, "reasoning must not be null");
        }
    }

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
        Objects.requireNonNull(policyVersion, "policyVersion must not be null");
        Objects.requireNonNull(currentBand, "currentBand must not be null");
        Objects.requireNonNull(forecastBand, "forecastBand must not be null");
        Objects.requireNonNull(required, "required must not be null");
        Objects.requireNonNull(advised, "advised must not be null");
    }

    /**
     * Check if any action requires immediate response (not just advice).
     * Used by legacy code that expects a boolean for rest requirement.
     */
    public boolean requiresRest() {
        return !required.isEmpty();
    }

    /**
     * Check if any required action exists.
     */
    public boolean hasRequiredAction() {
        return !required.isEmpty();
    }

    /**
     * Check if emergency stop is required.
     */
    public boolean isEmergencyStop() {
        return required.stream()
                .anyMatch(action -> PolicyDecision.Action.STOP_WORK.name().equals(action.action()));
    }

    /**
     * Get the primary required action (first in list).
     */
    public PolicyAction getPrimaryRequiredAction() {
        return required.isEmpty() ? null : required.get(0);
    }
}
