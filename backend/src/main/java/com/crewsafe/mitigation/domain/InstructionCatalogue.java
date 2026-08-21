package com.crewsafe.mitigation.domain;

import java.util.Optional;
import java.util.Set;

/**
 * The code a client uses to render a dispatched instruction in the worker's own language.
 *
 * <p><strong>Why this is not {@code actionCode}.</strong> A dispatch already carries an action
 * code, but it is the <em>dispatch</em> code from
 * {@link ActionCatalogue#toDispatchCode(String)}, which deliberately collapses the recurring
 * forms: {@code HYDRATE_HOURLY} and {@code HYDRATE_REGULARLY} both become {@code HYDRATE}, and
 * {@code SHADE_RECOVERY} becomes {@code SEEK_SHADE}. That is right for grouping and wrong for
 * wording -- "drink water every hour, roughly one cup per break" and "drink water regularly
 * throughout the shift" say different things about how often to drink, and the collapsed code
 * cannot choose between them.
 *
 * <p><strong>Why it is not the instruction text either.</strong> The text is written by the
 * language model. {@code MitigationSuggestion.action} is a free string on the ml-service side
 * (1..200 characters), so the sentence a worker receives is whatever Bedrock composed for that
 * request -- it is never guaranteed to match any fixed table, and a client matching on it can
 * only ever translate the deterministic-fallback wording. The model is nevertheless constrained
 * to a ten-code allowlist that the policy engine must already have mandated, so the CODE is
 * trustworthy in exactly the way the prose is not.
 *
 * <p><strong>The case that makes this safety-critical.</strong> A lightning stop-work and a
 * heat stop-work both carry {@code STOP_WORK}: {@code DeterministicPlanBuilder.forLightning()}
 * builds its mitigation with that code and distinguishes itself only by rule reference. One
 * instruction moves the crew to shade; the other moves them into a substantial building. Shade
 * is the wrong place to stand in a thunderstorm, so resolving both to one code would put a
 * dangerous instruction on screen. That distinction is recovered here, from the rule reference,
 * and is the reason this class takes the whole mitigation rather than just its code.
 *
 * @author Justin Chua
 */
public final class InstructionCatalogue {

    private InstructionCatalogue() {
    }

    /**
     * The rule reference {@code DeterministicPlanBuilder.forLightning()} stamps on its
     * stop-work. Duplicated as a literal rather than imported because that constant is
     * package-private in {@code operation.service} and this class sits in {@code
     * mitigation.domain}; {@link #LIGHTNING_STOP_WORK} is covered by a test that fails if the
     * two ever drift.
     */
    private static final String LIGHTNING_RULE_REFERENCE = "LIGHTNING_STOP_WORK_RULE";

    private static final String STOP_WORK = "STOP_WORK";

    /** The lightning variant of {@code STOP_WORK}: shelter in a building, not in shade. */
    public static final String LIGHTNING_STOP_WORK = "STOP_WORK_LIGHTNING";

    /**
     * Every instruction code a client must be able to translate.
     *
     * <p>The ten codes the model may use, plus the lightning variant this class derives. The
     * collapsed dispatch forms are absent on purpose -- they are what this class exists to
     * avoid emitting.
     */
    private static final Set<String> INSTRUCTION_CODES = Set.of(
            STOP_WORK,
            LIGHTNING_STOP_WORK,
            "RESUME_WORK",
            "REST_10_MIN_HOURLY",
            "REST_15_MIN_HOURLY",
            "HYDRATE_HOURLY",
            "HYDRATE_REGULARLY",
            "SHADE_RECOVERY",
            "RESCHEDULE_HEAVY_WORK",
            "ROTATE_TO_LIGHT_DUTY",
            "CLOSE_MONITORING");

    public static Set<String> instructionCodes() {
        return INSTRUCTION_CODES;
    }

    /**
     * The instruction code for a mitigation, or empty when the client should render the
     * mitigation's own text instead.
     *
     * <p>Empty is a real answer, not a failure. It means this mitigation carries a code with no
     * canned sentence behind it -- a supervisor's edit that narrowed an action to a one-shot
     * form, or a code added to the catalogue before its translations landed. A client that
     * receives no code falls back to the server's text, which is exactly the behaviour that
     * shipped before this field existed.
     *
     * @param actionCode    the mitigation's own un-collapsed code, not its dispatch code
     * @param ruleReference the rule that justified it; distinguishes lightning from heat
     */
    public static Optional<String> instructionCodeFor(String actionCode, String ruleReference) {
        if (actionCode == null || !INSTRUCTION_CODES.contains(actionCode)) {
            return Optional.empty();
        }
        if (STOP_WORK.equals(actionCode) && LIGHTNING_RULE_REFERENCE.equals(ruleReference)) {
            return Optional.of(LIGHTNING_STOP_WORK);
        }
        return Optional.of(actionCode);
    }
}
