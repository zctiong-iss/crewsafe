package com.crewsafe.operation.service;

import com.crewsafe.lightning.domain.LightningRiskState;
import com.crewsafe.mitigation.domain.MitigationSuggestion;
import com.crewsafe.policy.domain.PolicyActionCode;
import com.crewsafe.policy.domain.PolicyDecision;
import com.crewsafe.weather.domain.WbgtBand;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Plans built without any language model, for the two cases where one must not or cannot run.
 *
 * <p><strong>Why this exists when ml-service already has a fallback.</strong> They cover
 * different failures, and neither can cover the other's. The Python fallback handles a model
 * that answered badly or not at all — it needs ml-service to be running to produce anything.
 * This one handles ml-service <em>itself</em> being unreachable, and the lightning case, where
 * the correct answer is known before any call and making one would be pointless. Between them
 * there is no state in which a supervisor asks for a plan and gets an error instead.
 *
 * <p>The two are held consistent by construction rather than by discipline: both render the
 * same {@link PolicyDecision} into the same {@link MitigationSuggestion} shape, driven by the
 * same action codes, so the only way they can disagree is in prose wording.
 *
 * @author Abu Bakar
 */
@Component
public class DeterministicPlanBuilder {

    /**
     * §7.1: a lightning stop-work outranks every heat rule, so it is not a policy-engine
     * decision and does not carry a heat rule reference.
     *
     * <p>The plan is deliberately just STOP_WORK. {@code ActionCatalogue} documents why nothing
     * shade-related belongs here: workers must be told to seek proper <em>shelter</em>, the
     * nearest translated action code is {@code SEEK_SHADE}, and shade is not shelter from
     * lightning. That instruction reaches workers as already-translated banner copy instead.
     */
    static final String LIGHTNING_RULE_REFERENCE = "LIGHTNING_STOP_WORK_RULE";

    private static final Map<String, MitigationSuggestion.Timing> TIMING_BY_CODE = Map.of(
            PolicyActionCode.REST_15_MIN_HOURLY, new MitigationSuggestion.Timing(15, 60, null),
            PolicyActionCode.REST_10_MIN_HOURLY, new MitigationSuggestion.Timing(10, 60, null),
            PolicyActionCode.HYDRATE_HOURLY, new MitigationSuggestion.Timing(null, 60, null));

    private static final Map<String, String> ACTION_TEXT = Map.ofEntries(
            Map.entry(PolicyActionCode.STOP_WORK, "Stop work immediately and move the crew to a cool, shaded area"),
            Map.entry(PolicyActionCode.RESUME_WORK, "Work may resume under normal precautions"),
            Map.entry(PolicyActionCode.REST_10_MIN_HOURLY, "Take a 10-minute rest break in shade every hour"),
            Map.entry(PolicyActionCode.REST_15_MIN_HOURLY, "Take a 15-minute rest break in shade every hour"),
            Map.entry(PolicyActionCode.HYDRATE_HOURLY, "Drink water every hour, roughly one cup per break"),
            Map.entry(PolicyActionCode.HYDRATE_REGULARLY, "Drink water regularly throughout the shift"),
            Map.entry(PolicyActionCode.SHADE_RECOVERY, "Keep shaded recovery space available to the crew"),
            Map.entry(PolicyActionCode.RESCHEDULE_HEAVY_WORK,
                    "Move heavy tasks to a cooler part of the day where possible"),
            Map.entry(PolicyActionCode.ROTATE_TO_LIGHT_DUTY, "Rotate affected workers onto lighter duties"),
            Map.entry(PolicyActionCode.CLOSE_MONITORING,
                    "Monitor affected workers closely for signs of heat illness"));

    private static final Map<String, String> IMPACT_TEXT = Map.ofEntries(
            Map.entry(PolicyActionCode.STOP_WORK, "Removes heat exposure entirely while the condition persists"),
            Map.entry(PolicyActionCode.RESUME_WORK, "Returns the crew to normal productivity under routine precautions"),
            Map.entry(PolicyActionCode.REST_10_MIN_HOURLY, "Lowers core body temperature between work periods"),
            Map.entry(PolicyActionCode.REST_15_MIN_HOURLY,
                    "Substantially lowers core body temperature between work periods"),
            Map.entry(PolicyActionCode.HYDRATE_HOURLY, "Replaces fluid lost to sweating and limits dehydration"),
            Map.entry(PolicyActionCode.HYDRATE_REGULARLY, "Maintains hydration across the shift"),
            Map.entry(PolicyActionCode.SHADE_RECOVERY, "Gives workers somewhere to cool down before symptoms develop"),
            Map.entry(PolicyActionCode.RESCHEDULE_HEAVY_WORK, "Cuts metabolic heat load during the hottest hours"),
            Map.entry(PolicyActionCode.ROTATE_TO_LIGHT_DUTY, "Reduces exposure for the workers most at risk"),
            Map.entry(PolicyActionCode.CLOSE_MONITORING, "Catches early heat illness before it becomes an emergency"));

    private static final Map<WbgtBand, String> BAND_TEXT = Map.of(
            WbgtBand.BELOW_31, "low heat risk",
            WbgtBand.BAND_31_TO_BELOW_32, "medium heat risk",
            WbgtBand.BAND_32_TO_BELOW_33, "high heat risk",
            WbgtBand.BAND_33_AND_ABOVE, "very high heat risk");

    /** One mitigation per policy action, mandatory first so the plan reads in priority order. */
    public List<MitigationSuggestion> fromPolicy(PolicyDecision decision) {
        List<MitigationSuggestion> plan = new ArrayList<>();
        decision.mandatoryActions().forEach(action -> plan.add(toMitigation(action, "MANDATORY", "HIGH")));
        decision.advisoryActions().forEach(action -> plan.add(toMitigation(action, "ADVISORY", "MEDIUM")));
        return plan;
    }

    /** The whole-plan paragraph mobile renders above the mitigation list. */
    public String rationaleFromPolicy(PolicyDecision decision, Double observedWbgt, String reason) {
        StringBuilder text = new StringBuilder();
        if (observedWbgt != null) {
            text.append(String.format("WBGT is %.1f°C, %s, assessed against heat policy %s. ",
                    observedWbgt, BAND_TEXT.getOrDefault(decision.currentBand(), "in an unclassified band"),
                    decision.policyVersion()));
        } else {
            text.append(String.format("No WBGT reading was available; assessed against heat policy %s. ",
                    decision.policyVersion()));
        }

        int mandatory = decision.mandatoryActions().size();
        int advisory = decision.advisoryActions().size();
        if (mandatory > 0) {
            text.append(String.format("%d control%s %s required%s. ", mandatory, mandatory == 1 ? "" : "s",
                    mandatory == 1 ? "is" : "are",
                    advisory > 0 ? String.format(", with %d further suggested", advisory) : ""));
        } else if (advisory > 0) {
            text.append(String.format("No controls are required at this reading; %d routine precaution%s %s suggested. ",
                    advisory, advisory == 1 ? "" : "s", advisory == 1 ? "is" : "are"));
        } else {
            text.append("No controls are required at this reading. ");
        }

        text.append("This plan came straight from the policy engine without the language model (")
                .append(reason)
                .append("), so the wording is fixed; the actions and their rule references are unaffected.");
        return text.toString();
    }

    /**
     * The plan for an active lightning stop-work, built without consulting the policy engine's
     * heat rules or the model at all.
     *
     * <p>{@code appliesTo} is every worker on the shift explicitly rather than left null. Null
     * means "whole shift" by the SCRUM-288 convention and would dispatch identically, but a
     * stop-work is the one instruction where an auditor should be able to read the stored plan
     * and see exactly who it covered, without having to reconstruct the roster as it was.
     */
    public List<MitigationSuggestion> forLightning(List<UUID> shiftWorkerIds) {
        List<String> workers = shiftWorkerIds.stream().map(UUID::toString).toList();
        return List.of(new MitigationSuggestion(
                "HIGH",
                "Stop work and move the crew to a substantial building or a fully enclosed vehicle",
                "Lightning has been detected within the site's stop-work radius. A lightning stop-work "
                        + "overrides every heat-based rule and applies regardless of the WBGT reading.",
                "Removes the crew's exposure to lightning strike for as long as the risk persists",
                PolicyActionCode.STOP_WORK,
                "STOP_WORK",
                "MANDATORY",
                LIGHTNING_RULE_REFERENCE,
                workers.isEmpty() ? null : workers,
                null));
    }

    public String rationaleForLightning(LightningRiskState state, Double observedWbgt) {
        return "Lightning has been detected within the site's stop-work radius (risk state " + state + "), "
                + "so all outdoor work must stop immediately. This overrides the heat-stress assessment: "
                + (observedWbgt == null
                        ? "no WBGT reading was available, and it would not change this instruction. "
                        : String.format("WBGT is %.1f°C, and it would not change this instruction. ", observedWbgt))
                + "Work may resume once the site's lightning risk has cleared.";
    }

    private MitigationSuggestion toMitigation(PolicyDecision.PolicyAction action, String origin, String priority) {
        String code = action.code();
        return new MitigationSuggestion(
                priority,
                ACTION_TEXT.getOrDefault(code, humanise(code)),
                // The policy engine's own reasoning, verbatim. It already explains the decision in
                // terms of the actual threshold and the worker's acclimatisation level; rewording it
                // here would be this class inventing an explanation for a decision it did not make.
                action.reasoning(),
                IMPACT_TEXT.getOrDefault(code, "Reduces heat stress risk for the workers affected"),
                code,
                com.crewsafe.mitigation.domain.ActionCatalogue.categoryOf(code).orElse("MONITORING"),
                origin,
                action.ruleReference(),
                // Empty becomes null, not an empty list: absent means "the whole shift", whereas an
                // empty list reads as "nobody" and would dispatch to no one.
                action.appliesTo().isEmpty() ? null : List.copyOf(action.appliesTo()),
                TIMING_BY_CODE.get(code));
    }

    private static String humanise(String code) {
        String spaced = code.replace('_', ' ').toLowerCase();
        return spaced.substring(0, 1).toUpperCase() + spaced.substring(1);
    }
}
