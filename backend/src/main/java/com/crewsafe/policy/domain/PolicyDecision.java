package com.crewsafe.policy.domain;

import java.util.List;
import java.util.Objects;
import org.springframework.lang.Nullable;

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
    @Nullable String forecastBand,
    List<PolicyAction> mandatoryActions,
    List<PolicyAction> advisoryActions
) {
    /**
     * Represents a single recommended action with its rule source and applicability.
     * Aligns with mobile app's PolicyEvaluationAction type.
     */
    public record PolicyAction(
        String code,
        String ruleReference,
        List<String> appliesTo,
        String reasoning
    ) {
        public PolicyAction {
            Objects.requireNonNull(code, "code must not be null");
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
        // forecastBand may be null if forecast is unavailable (degraded mode per §7.1)
        Objects.requireNonNull(mandatoryActions, "mandatoryActions must not be null");
        Objects.requireNonNull(advisoryActions, "advisoryActions must not be null");
    }

    /**
     * Check if any action requires immediate response (not just advice).
     * Used by legacy code that expects a boolean for rest requirement.
     */
    public boolean requiresRest() {
        return !mandatoryActions.isEmpty();
    }

    /**
     * Check if any mandatory action exists.
     */
    public boolean hasRequiredAction() {
        return !mandatoryActions.isEmpty();
    }

    /**
     * Check if emergency stop is required.
     */
    public boolean isEmergencyStop() {
        return mandatoryActions.stream()
                .anyMatch(action -> PolicyDecision.Action.STOP_WORK.name().equals(action.code()));
    }

    /**
     * Get the primary mandatory action (first in list).
     */
    public PolicyAction getPrimaryRequiredAction() {
        return mandatoryActions.isEmpty() ? null : mandatoryActions.get(0);
    }
}
