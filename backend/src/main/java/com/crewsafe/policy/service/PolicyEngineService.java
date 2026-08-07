package com.crewsafe.policy.service;

import com.crewsafe.policy.domain.*;
import com.crewsafe.policy.repository.PolicyConfigRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.NoSuchElementException;
import java.util.UUID;

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
        Double threshold = policy.getThreshold(level, workIntensity);

        // Make decision based on WBGT vs thresholds
        PolicyDecision decision = makeDecision(currentWbgt, threshold, level, workIntensity, policy);

        log.info(
                "Policy evaluated for site={}, WBGT={}, intensity={}, acclimatisation={}, action={}",
                siteId, currentWbgt, workIntensity, level, decision.action()
        );

        return decision;
    }

    /**
     * Make policy decision based on thresholds.
     *
     * Decision logic:
     * 1. If WBGT >= emergency stop → STOP_WORK
     * 2. If WBGT >= threshold → evaluate intensity and acclimatisation
     *    - Unacclimatised + moderate/heavy = EXTENDED_REST
     *    - Partial + moderate/heavy = SHORT_REST
     *    - Full or light intensity = SHORT_REST
     * 3. If WBGT < threshold → CONTINUE
     */
    private PolicyDecision makeDecision(
            Double wbgt,
            Double threshold,
            AcclimatisationLevel level,
            HeatRestPolicy.WorkIntensity intensity,
            HeatRestPolicy policy
    ) {
        // Emergency stop: WBGT critical
        if (wbgt >= policy.getWbgtEmergencyStop()) {
            return new PolicyDecision(
                    PolicyDecision.Action.STOP_WORK,
                    RestRecommendation.EMERGENCY,
                    String.format(
                            "WBGT %.1f°C exceeds emergency stop threshold %.1f°C; " +
                                    "worker at imminent heat illness risk",
                            wbgt, policy.getWbgtEmergencyStop()
                    )
            );
        }

        // WBGT exceeds threshold: recommend rest
        if (wbgt >= threshold) {
            // Determine rest type based on acclimatisation and intensity
            PolicyDecision.Action action;
            RestRecommendation rest;

            if (level == AcclimatisationLevel.UNACCLIMATISED &&
                    (intensity == HeatRestPolicy.WorkIntensity.MODERATE ||
                     intensity == HeatRestPolicy.WorkIntensity.HEAVY)) {
                // Unacclimatised workers under load need extended rest
                action = PolicyDecision.Action.EXTENDED_REST;
                rest = RestRecommendation.EXTENDED;
            } else {
                // Others need short rest
                action = PolicyDecision.Action.SHORT_REST;
                rest = RestRecommendation.SHORT;
            }

            return new PolicyDecision(
                    action,
                    rest,
                    String.format(
                            "WBGT %.1f°C exceeds threshold %.1f°C for %s worker " +
                                    "on %s intensity work; heat stress detected",
                            wbgt, threshold, level, intensity
                    )
            );
        }

        // WBGT within safe range
        return new PolicyDecision(
                PolicyDecision.Action.CONTINUE,
                RestRecommendation.NONE,
                String.format(
                        "WBGT %.1f°C is below threshold %.1f°C for %s worker " +
                                "on %s intensity work; continue work",
                        wbgt, threshold, level, intensity
                )
        );
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
