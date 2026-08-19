package com.crewsafe.policy.service;

import com.crewsafe.policy.domain.*;
import com.crewsafe.policy.repository.PolicyVersionRepository;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.weather.domain.WbgtBand;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
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
 *
 * <p>Lightning is not this service's concern. Per §7.1 of the project plan, a lightning
 * stop-work outranks every heat rule and is evaluated upstream by the caller (the SCRUM-118
 * agent graph), which short-circuits to a fixed stop-work plan before this service — or the
 * LLM — is ever reached.
 *
 * @author Jemilin Beulah
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
@Slf4j
public class PolicyEngineService {

    private final PolicyVersionRepository policyVersionRepository;
    private final AcclimatisationCalculator acclimatisationCalculator;

    /**
     * Evaluate policy and recommend action for one worker based on current conditions.
     *
     * @param siteId site identifier
     * @param workerId the worker this evaluation applies to — recorded verbatim in every
     *                 emitted {@link PolicyDecision.PolicyAction#appliesTo()}, so a caller
     *                 evaluating multiple workers on the same shift can tell them apart
     * @param currentWbgt current WBGT measurement in °C
     * @param workIntensity work intensity level (LIGHT, MODERATE, HEAVY)
     * @param acclimatisationDay shift acclimatisation day (1-based)
     * @return PolicyDecision with recommended action and rest guidance
     * @throws NoSuchElementException if no policy configured for site
     * @throws IllegalArgumentException if inputs are invalid
     */
    public PolicyDecision evaluate(
            UUID siteId,
            UUID workerId,
            Double currentWbgt,
            WorkIntensity workIntensity,
            int acclimatisationDay
    ) {
        validateInputs(workerId, currentWbgt, workIntensity, acclimatisationDay);

        PolicyVersion policy = resolveActivePolicy(siteId);

        AcclimatisationLevel level = AcclimatisationLevel.fromDay(acclimatisationDay);
        BigDecimal threshold = policy.getThreshold(level, workIntensity);

        PolicyDecision decision = makeDecision(
                List.of(workerId), currentWbgt, threshold, level, workIntensity, policy);

        log.info(
                "policy_evaluation_completed intensity={} acclimatisation={} mandatory={} advisory={}",
                workIntensity, level,
                decision.mandatoryActions().size(), decision.advisoryActions().size()
        );

        return decision;
    }

    /**
     * Evaluate policy for every worker assigned to a shift and merge the result into one
     * {@link PolicyDecision}, so a caller building a single {@code Recommendation} for a
     * shift does not have to reconcile N separate per-worker decisions itself.
     *
     * <p>Each assignment is evaluated independently via {@link #evaluate}, since a worker's
     * intensity and acclimatisation day can differ from their shift-mates'. Actions that land
     * on the same {@link PolicyActionCode} are then merged into a single
     * {@link PolicyDecision.PolicyAction} whose {@code appliesTo} lists every worker it
     * applies to, rather than emitting one action per worker per code — ten workers all owed
     * an hourly rest produces one {@code REST_10_MIN_HOURLY} action naming all ten, not ten
     * near-identical actions.
     *
     * <p>An assignment with no {@code acclimatisationDay} recorded is treated as day 1
     * (unacclimatised) — the strictest tier, not the most lenient. Missing data defaults to
     * more protection required, not less, consistent with §7.1's stale-data rule (treat
     * unknown conditions conservatively rather than assume the safe case).
     *
     * @param siteId site identifier
     * @param currentWbgt current WBGT measurement in °C
     * @param assignments the shift's worker assignments; an empty list yields a decision with
     *                     the current band but no actions
     * @return one merged PolicyDecision covering every assignment
     * @throws NoSuchElementException if no policy configured for site
     * @throws IllegalArgumentException if currentWbgt is invalid
     */
    public PolicyDecision evaluateForShift(
            UUID siteId,
            Double currentWbgt,
            List<ShiftAssignment> assignments
    ) {
        Objects.requireNonNull(assignments, "assignments must not be null");

        if (assignments.isEmpty()) {
            validateWbgt(currentWbgt);
            // Still require a resolvable policy for the site, matching evaluate()'s
            // behaviour, even though an empty assignment list needs nothing else from it.
            PolicyVersion policy = resolveActivePolicy(siteId);
            WbgtBand band = WbgtBand.classify(BigDecimal.valueOf(currentWbgt));
            return new PolicyDecision(policy.getVersionLabel(), band, band, List.of(), List.of());
        }

        List<PolicyDecision> perWorker = assignments.stream()
                .map(assignment -> evaluate(
                        siteId,
                        assignment.getWorkerId(),
                        currentWbgt,
                        toWorkIntensity(assignment.getIntensity()),
                        assignment.getAcclimatisationDay() != null ? assignment.getAcclimatisationDay() : 1
                ))
                .toList();

        return mergeByActionCode(perWorker);
    }

    /**
     * The site's own {@code ACTIVE} version if it has one; otherwise the one company-wide
     * default (V18, {@code siteId IS NULL}) — MOM's published thresholds, seeded once and
     * never edited through the application. A site that wants something different doesn't
     * edit the default, it configures and activates its own version, which then always takes
     * precedence here.
     *
     * @throws NoSuchElementException if the site has no version of its own and the default is
     *                                 somehow not ACTIVE either (should not happen in practice —
     *                                 V18 seeds it as ACTIVE and nothing in the application ever
     *                                 deactivates it)
     */
    private PolicyVersion resolveActivePolicy(UUID siteId) {
        return policyVersionRepository.findBySiteIdAndStatus(siteId, PolicyVersionStatus.ACTIVE)
                .or(() -> policyVersionRepository.findBySiteIdIsNullAndStatus(PolicyVersionStatus.ACTIVE))
                .orElseThrow(() -> new NoSuchElementException(
                        "No policy configured for site " + siteId + " and no company default is active"));
    }

    private static WorkIntensity toWorkIntensity(
            com.crewsafe.shift.domain.Intensity intensity
    ) {
        return switch (intensity) {
            case LIGHT -> WorkIntensity.LIGHT;
            case MODERATE -> WorkIntensity.MODERATE;
            case HEAVY -> WorkIntensity.HEAVY;
        };
    }

    /**
     * Combines a list of single-worker decisions (all for the same site and WBGT reading,
     * so {@code policyVersion}/{@code currentBand}/{@code forecastBand} are identical across
     * all of them) into one, merging {@link PolicyDecision.PolicyAction}s that share a code
     * by unioning their {@code appliesTo} lists. {@code ruleReference} and {@code reasoning}
     * are taken from the first occurrence — different workers reaching the same code can
     * differ slightly in wording (their own threshold value), and picking one representative
     * explanation is preferable to concatenating N near-duplicate sentences.
     */
    private static PolicyDecision mergeByActionCode(List<PolicyDecision> perWorker) {
        PolicyDecision first = perWorker.get(0);
        List<PolicyDecision.PolicyAction> mandatory = mergeActions(
                perWorker.stream().flatMap(d -> d.mandatoryActions().stream()).toList());
        List<PolicyDecision.PolicyAction> advisory = mergeActions(
                perWorker.stream().flatMap(d -> d.advisoryActions().stream()).toList());

        return new PolicyDecision(
                first.policyVersion(), first.currentBand(), first.forecastBand(), mandatory, advisory);
    }

    private static List<PolicyDecision.PolicyAction> mergeActions(List<PolicyDecision.PolicyAction> actions) {
        Map<String, PolicyDecision.PolicyAction> byCode = new LinkedHashMap<>();
        Map<String, List<String>> appliesToByCode = new LinkedHashMap<>();

        for (PolicyDecision.PolicyAction action : actions) {
            byCode.putIfAbsent(action.code(), action);
            appliesToByCode.computeIfAbsent(action.code(), c -> new ArrayList<>()).addAll(action.appliesTo());
        }

        return byCode.entrySet().stream()
                .map(entry -> new PolicyDecision.PolicyAction(
                        entry.getKey(),
                        entry.getValue().ruleReference(),
                        List.copyOf(appliesToByCode.get(entry.getKey())),
                        entry.getValue().reasoning()
                ))
                .toList();
    }

    /**
     * Make policy decision based on thresholds.
     *
     * Decision logic:
     * 1. WBGT >= site threshold → mandatory rest (10 or 15 min, hourly, by severity) +
     *    mandatory HYDRATE_HOURLY + advisory CLOSE_MONITORING; heavy-intensity work also
     *    gets advisory RESCHEDULE_HEAVY_WORK, and an unacclimatised worker on heavy
     *    intensity additionally gets advisory ROTATE_TO_LIGHT_DUTY
     *    - Unacclimatised + moderate/heavy = REST_15_MIN_HOURLY (the more severe tier)
     *    - Everyone else = REST_10_MIN_HOURLY
     * 2. WBGT < threshold → advisory HYDRATE_REGULARLY + advisory SHADE_RECOVERY
     *
     * <p>{@code wbgtEmergencyStop} is retained on policy records for compatibility but is
     * deprecated and intentionally ignored here. Heat controls must not become a universal
     * stop-work order; the lightning risk path owns automatic stop-work decisions.
     *
     * currentBand/forecastBand come from {@link WbgtBand#classify}, the same global,
     * server-authoritative classification the weather module exposes over HTTP — not a
     * separate scale derived from this site's configured rest thresholds. The two are
     * deliberately independent: the band is a shared, site-agnostic reading of how hot it
     * is; the site's {@link PolicyVersion} thresholds are what actually decide whether an
     * action is required, and can legitimately differ per site per §7.1 ("thresholds are
     * configuration records, not hard-coded").
     *
     * forecastBand is null if forecast service is unavailable (degraded mode per §7.1).
     */
    private PolicyDecision makeDecision(
            List<UUID> appliesTo,
            Double wbgt,
            BigDecimal threshold,
            AcclimatisationLevel level,
            WorkIntensity intensity,
            PolicyVersion policy
    ) {
        String policyVersion = policy.getVersionLabel();
        WbgtBand currentBand = WbgtBand.classify(BigDecimal.valueOf(wbgt));
        // SCRUM-188 limitation: policy evaluation does not yet receive a forecast value, so its
        // forecast band remains the current band until forecast integration supplies that input.
        WbgtBand forecastBand = currentBand;

        List<String> workerIds = appliesTo.stream().map(UUID::toString).toList();
        List<PolicyDecision.PolicyAction> mandatoryActions = new ArrayList<>();
        List<PolicyDecision.PolicyAction> advisoryActions = new ArrayList<>();

        // WBGT exceeds site threshold: rest and hydration required
        if (BigDecimal.valueOf(wbgt).compareTo(threshold) >= 0) {
            boolean severe = level == AcclimatisationLevel.UNACCLIMATISED
                    && (intensity == WorkIntensity.MODERATE
                        || intensity == WorkIntensity.HEAVY);

            String restCode = severe ? PolicyActionCode.REST_15_MIN_HOURLY : PolicyActionCode.REST_10_MIN_HOURLY;
            String ruleRef = severe ? "UNACCLIMATISED_HEAVY_WORK_RULE" : "HEAT_STRESS_REST_RULE";
            String reasoning = String.format(
                    "WBGT %.1f°C exceeds threshold %.1f°C for %s worker "
                            + "on %s intensity work; heat stress detected",
                    wbgt, threshold, level, intensity
            );

            mandatoryActions.add(new PolicyDecision.PolicyAction(restCode, ruleRef, workerIds, reasoning));
            mandatoryActions.add(new PolicyDecision.PolicyAction(
                    PolicyActionCode.HYDRATE_HOURLY, ruleRef, workerIds, reasoning));
            advisoryActions.add(new PolicyDecision.PolicyAction(
                    PolicyActionCode.CLOSE_MONITORING, ruleRef, workerIds, reasoning));

            if (intensity == WorkIntensity.HEAVY) {
                advisoryActions.add(new PolicyDecision.PolicyAction(
                        PolicyActionCode.RESCHEDULE_HEAVY_WORK, ruleRef, workerIds, reasoning));

                if (level == AcclimatisationLevel.UNACCLIMATISED) {
                    advisoryActions.add(new PolicyDecision.PolicyAction(
                            PolicyActionCode.ROTATE_TO_LIGHT_DUTY, "UNACCLIMATISED_HEAVY_WORK_RULE", workerIds,
                            "Unacclimatised worker on heavy-intensity work; rotating to light duty "
                                    + "reduces exposure while acclimatising"));
                }
            }

            return new PolicyDecision(policyVersion, currentBand, forecastBand, mandatoryActions, advisoryActions);
        }

        // Safe range: routine hydration and shade access
        String reasoning = String.format(
                "WBGT %.1f°C is below threshold %.1f°C for %s worker "
                        + "on %s intensity work; routine precautions apply",
                wbgt, threshold, level, intensity
        );
        advisoryActions.add(new PolicyDecision.PolicyAction(
                PolicyActionCode.HYDRATE_REGULARLY, "SAFE_WORK_RULE", workerIds, reasoning));
        advisoryActions.add(new PolicyDecision.PolicyAction(
                PolicyActionCode.SHADE_RECOVERY, "SAFE_WORK_RULE", workerIds,
                "Maintain access to shade for recovery breaks"));
        return new PolicyDecision(policyVersion, currentBand, forecastBand, mandatoryActions, advisoryActions);
    }

    private void validateInputs(
            UUID workerId, Double wbgt, WorkIntensity intensity, int acclimatisationDay
    ) {
        if (workerId == null) {
            throw new IllegalArgumentException("workerId must not be null");
        }
        validateWbgt(wbgt);
        if (intensity == null) {
            throw new IllegalArgumentException("Work intensity must not be null");
        }
        if (acclimatisationDay < 1 || acclimatisationDay > 365) {
            throw new IllegalArgumentException(
                    "Acclimatisation day must be between 1 and 365, got " + acclimatisationDay
            );
        }
    }

    private void validateWbgt(Double wbgt) {
        if (wbgt == null || wbgt < 15 || wbgt > 40) {
            throw new IllegalArgumentException(
                    "WBGT must be between 15°C and 40°C, got " + wbgt
            );
        }
    }
}
