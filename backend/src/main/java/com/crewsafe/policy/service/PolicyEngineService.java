package com.crewsafe.policy.service;

import com.crewsafe.policy.domain.*;
import com.crewsafe.policy.repository.PolicyConfigRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.UUID;
import java.math.BigDecimal;

/**
 * Policy evaluation engine for heat-rest decisions.
 *
 * Stateless service that evaluates WBGT, worker acclimatisation, and work intensity
 * to recommend appropriate work-rest actions per MOM guidelines.
 *
 * This service is internal and is not exposed as a REST endpoint.
 * It is called by Operation and Mitigation services to make safety decisions.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
@Slf4j
public class PolicyEngineService {

    private final PolicyConfigRepository policyConfigRepository;
    private final AcclimatisationCalculator acclimatisationCalculator;

    /**
     * Evaluate policy and recommend action based on current conditions.
     *
     * @param siteId site identifier
     * @param currentWbgt current WBGT measurement in °C
     * @param workIntensity work intensity level (LIGHT, MODERATE, HEAVY)
     * @param acclimatisationDay shift acclimatisation day (1-based)
     * @return PolicyDecision with recommended action and rest guidance
     * @throws NoSuchElementException if no policy configured for site
     * @throws IllegalArgumentException if inputs are invalid
     */
    public PolicyDecision evaluate(
            UUID siteId,
            Double currentWbgt,
            HeatRestPolicy.WorkIntensity workIntensity,
            int acclimatisationDay
    ) {
        // Input validation
        validateInputs(currentWbgt, workIntensity, acclimatisationDay);

        // Fetch site policy
        HeatRestPolicy policy = policyConfigRepository.findBySiteId(siteId)
                .orElseThrow(() -> new NoSuchElementException(
                        "No policy configured for site " + siteId
                ));

        // Calculate acclimatisation level
        AcclimatisationLevel level = AcclimatisationLevel.fromDay(acclimatisationDay);

        // Get threshold for this level + intensity
        BigDecimal threshold = policy.getThreshold(level, workIntensity);

        // Make decision based on WBGT vs thresholds
        PolicyDecision decision = makeDecision(currentWbgt, threshold, level, workIntensity, policy);

        log.info(
                "Policy evaluated for site={}, WBGT={}, intensity={}, acclimatisation={}, required={}, advised={}",
                siteId, currentWbgt, workIntensity, level, decision.required().size(), decision.advised().size()
        );

        return decision;
    }

    /**
     * Make policy decision based on thresholds.
     *
     * Decision logic:
     * 1. If WBGT >= emergency stop → STOP_WORK (required action)
     * 2. If WBGT >= threshold → recommend rest (required or advised based on conditions)
     *    - Unacclimatised + moderate/heavy = EXTENDED_REST (required)
     *    - Partial + moderate/heavy = SHORT_REST (required)
     *    - Full or light intensity = SHORT_REST (advised)
     * 3. If WBGT < threshold → CONTINUE (no actions needed)
     *
     * Returns PolicyDecision with actions split into required vs advised.
     * Each action includes ruleReference (which rule triggered it) and appliesTo[] (applicability conditions).
     */
    private PolicyDecision makeDecision(
            Double wbgt,
            BigDecimal threshold,
            AcclimatisationLevel level,
            HeatRestPolicy.WorkIntensity intensity,
            HeatRestPolicy policy
    ) {
        String policyVersion = "1.0"; // MOM Heat Stress Management Standards
        String currentBand = determineBand(wbgt, policy);
        String forecastBand = currentBand; // forecast band can be enhanced later with predicted WBGT

        List<PolicyDecision.PolicyAction> required = new ArrayList<>();
        List<PolicyDecision.PolicyAction> advised = new ArrayList<>();

        // Emergency stop: WBGT critical
        if (wbgt >= policy.getWbgtEmergencyStop()) {
            required.add(new PolicyDecision.PolicyAction(
                    PolicyDecision.Action.STOP_WORK.name(),
                    "EMERGENCY_STOP_RULE",
                    List.of("all_workers"),
                    String.format(
                            "WBGT %.1f°C exceeds emergency stop threshold %.1f°C; " +
                                    "worker at imminent heat illness risk",
                            wbgt, policy.getWbgtEmergencyStop()
                    )
            ));
            return new PolicyDecision(policyVersion, currentBand, forecastBand, required, advised);
        }

        // WBGT exceeds threshold: recommend rest
        if (wbgt >= threshold) {
            String ruleRef;
            String action;
            List<String> appliesTo;

            if (level == AcclimatisationLevel.UNACCLIMATISED &&
                    (intensity == HeatRestPolicy.WorkIntensity.MODERATE ||
                     intensity == HeatRestPolicy.WorkIntensity.HEAVY)) {
                // Unacclimatised workers under load need extended rest (required)
                action = PolicyDecision.Action.EXTENDED_REST.name();
                ruleRef = "UNACCLIMATISED_HEAVY_WORK_RULE";
                appliesTo = List.of("unacclimatised", "moderate_or_heavy_work");
            } else {
                // Others need short rest
                action = PolicyDecision.Action.SHORT_REST.name();
                ruleRef = "HEAT_STRESS_REST_RULE";
                appliesTo = List.of("level_" + level.name().toLowerCase(), intensity.name().toLowerCase() + "_work");
            }

            PolicyDecision.PolicyAction restAction = new PolicyDecision.PolicyAction(
                    action,
                    ruleRef,
                    appliesTo,
                    String.format(
                            "WBGT %.1f°C exceeds threshold %.1f°C for %s worker " +
                                    "on %s intensity work; heat stress detected",
                            wbgt, threshold, level, intensity
                    )
            );
            required.add(restAction);
            return new PolicyDecision(policyVersion, currentBand, forecastBand, required, advised);
        }

        // WBGT within safe range - worker can continue
        advised.add(new PolicyDecision.PolicyAction(
                PolicyDecision.Action.CONTINUE.name(),
                "SAFE_WORK_RULE",
                List.of("all_workers"),
                String.format(
                        "WBGT %.1f°C is below threshold %.1f°C for %s worker " +
                                "on %s intensity work; continue work",
                        wbgt, threshold, level, intensity
                )
        ));
        return new PolicyDecision(policyVersion, currentBand, forecastBand, required, advised);
    }

    /**
     * Determine the heat stress band based on WBGT.
     * Uses standard MOM categories:
     * - CRITICAL: WBGT >= emergency stop threshold
     * - HIGH: WBGT in upper threshold range
     * - MODERATE: WBGT in middle threshold range
     * - LOW: WBGT below typical thresholds
     */
    private String determineBand(Double wbgt, HeatRestPolicy policy) {
        if (wbgt >= policy.getWbgtEmergencyStop()) {
            return "CRITICAL";
        } else if (wbgt >= 28.0) {
            return "HIGH";
        } else if (wbgt >= 26.0) {
            return "MODERATE";
        } else {
            return "LOW";
        }
    }

    /**
     * Validate input parameters.
     *
     * @throws IllegalArgumentException if any input is invalid
     */
    private void validateInputs(Double wbgt, HeatRestPolicy.WorkIntensity intensity, int acclimatisationDay) {
        if (wbgt == null || wbgt < 15 || wbgt > 40) {
            throw new IllegalArgumentException(
                    "WBGT must be between 15°C and 40°C, got " + wbgt
            );
        }
        if (intensity == null) {
            throw new IllegalArgumentException("Work intensity must not be null");
        }
        if (acclimatisationDay < 1 || acclimatisationDay > 365) {
            throw new IllegalArgumentException(
                    "Acclimatisation day must be between 1 and 365, got " + acclimatisationDay
            );
        }
    }
}
