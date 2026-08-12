package com.crewsafe.policy.domain;

import com.crewsafe.weather.domain.WbgtBand;

import java.util.List;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * Immutable result of policy evaluation.
 *
 * Contains the recommended actions based on WBGT, intensity, and acclimatisation level.
 * Aligns with mobile app's PolicyEvaluation type for consistent API contract.
 * This is a value object (record) to enforce immutability.
 *
 * <p>{@code currentBand}/{@code forecastBand} reuse {@link WbgtBand} rather than a
 * separately-invented string vocabulary — it is the same server-authoritative
 * classification the weather module already exposes over HTTP, with the same half-open,
 * null-safe boundary behaviour, so a policy endpoint serialises to exactly what mobile's
 * {@code WbgtBand} union type expects with no translation layer in between.
 */
public record PolicyDecision(
    String policyVersion,
    WbgtBand currentBand,
    @Nullable WbgtBand forecastBand,
    List<PolicyAction> mandatoryActions,
    List<PolicyAction> advisoryActions
) {
    /**
     * Represents a single recommended action with its rule source and applicability.
     * Aligns with mobile app's PolicyEvaluationAction type.
     *
     * <p>{@code code} must be one of {@link PolicyActionCode}'s constants — this record does
     * not enforce that itself (a plain {@code String} field can't), so any caller assembling
     * a {@code PolicyAction} by hand is responsible for using the constant, not a literal.
     *
     * <p>{@code appliesTo} carries the worker UUIDs (as strings) this action applies to, not
     * a description of the conditions that triggered it — the condition is already captured
     * by {@code ruleReference} and {@code reasoning}. An action with no specific worker
     * (e.g. a site-wide stop-work) uses every worker UUID passed to the evaluation.
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
                .anyMatch(action -> PolicyActionCode.STOP_WORK.equals(action.code()));
    }

    /**
     * Get the primary mandatory action (first in list).
     */
    public PolicyAction getPrimaryRequiredAction() {
        return mandatoryActions.isEmpty() ? null : mandatoryActions.get(0);
    }
}
