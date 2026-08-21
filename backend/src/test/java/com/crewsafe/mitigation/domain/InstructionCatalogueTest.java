package com.crewsafe.mitigation.domain;

import com.crewsafe.policy.domain.PolicyActionCode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Which mitigations earn a translatable instruction code, and which must not.
 *
 * <p>The dangerous direction here is not a missing code -- that degrades to English text a
 * worker can still act on. It is emitting the WRONG code, because the client trusts it enough
 * to replace the sentence entirely.
 *
 * @author Justin Chua
 */
class InstructionCatalogueTest {

    /** Must match {@code DeterministicPlanBuilder.LIGHTNING_RULE_REFERENCE}. */
    private static final String LIGHTNING_RULE = "LIGHTNING_STOP_WORK_RULE";

    private static final String HEAT_RULE = "HS-33-HEAVY";

    @Test
    @DisplayName("a heat stop-work and a lightning stop-work resolve to different instructions")
    void stopWorkVariantsAreDistinguished() {
        /*
         * The case that makes this class exist. Both mitigations carry STOP_WORK -- only the
         * rule reference says one of them means "shelter in a building". Collapsing them would
         * tell a crew to stand in shade during a thunderstorm.
         */
        assertThat(InstructionCatalogue.instructionCodeFor(PolicyActionCode.STOP_WORK, HEAT_RULE))
                .contains("STOP_WORK");
        assertThat(InstructionCatalogue.instructionCodeFor(PolicyActionCode.STOP_WORK, LIGHTNING_RULE))
                .contains(InstructionCatalogue.LIGHTNING_STOP_WORK);
    }

    @Test
    @DisplayName("the lightning rule only changes STOP_WORK, never another action")
    void lightningRuleDoesNotLeakOntoOtherActions() {
        // A lightning plan may carry CLOSE_MONITORING alongside its stop-work. That action's
        // instruction is unchanged by the weather that prompted it.
        assertThat(InstructionCatalogue.instructionCodeFor("CLOSE_MONITORING", LIGHTNING_RULE))
                .contains("CLOSE_MONITORING");
    }

    @Test
    @DisplayName("the two hydration forms stay distinct, which the dispatch code cannot do")
    void hydrationFormsAreNotCollapsed() {
        /*
         * ActionCatalogue.toDispatchCode maps both of these to HYDRATE, and the two sentences
         * behind them say different things about how often to drink. This is the reason the
         * client is given a second code rather than reusing the one already on the dispatch.
         */
        assertThat(ActionCatalogue.toDispatchCode("HYDRATE_HOURLY"))
                .isEqualTo(ActionCatalogue.toDispatchCode("HYDRATE_REGULARLY"));

        assertThat(InstructionCatalogue.instructionCodeFor("HYDRATE_HOURLY", HEAT_RULE))
                .contains("HYDRATE_HOURLY");
        assertThat(InstructionCatalogue.instructionCodeFor("HYDRATE_REGULARLY", HEAT_RULE))
                .contains("HYDRATE_REGULARLY");
    }

    @Test
    @DisplayName("a collapsed dispatch code is never emitted as an instruction code")
    void collapsedFormsAreRejected() {
        // SEEK_SHADE and HYDRATE are dispatch forms. Accepting one here would mean a
        // supervisor's narrowed edit silently rendered as the recurring sentence.
        assertThat(InstructionCatalogue.instructionCodeFor("SEEK_SHADE", HEAT_RULE)).isEmpty();
        assertThat(InstructionCatalogue.instructionCodeFor("HYDRATE", HEAT_RULE)).isEmpty();
        assertThat(InstructionCatalogue.instructionCodeFor("REST_15_MIN", HEAT_RULE)).isEmpty();
    }

    @Test
    @DisplayName("an unknown or absent code yields no instruction code rather than a guess")
    void unknownCodesDegradeToText() {
        assertThat(InstructionCatalogue.instructionCodeFor(null, HEAT_RULE)).isEmpty();
        assertThat(InstructionCatalogue.instructionCodeFor("AI_RECOMMENDED_ACTION", HEAT_RULE)).isEmpty();
        assertThat(InstructionCatalogue.instructionCodeFor("", HEAT_RULE)).isEmpty();
    }

    @Test
    @DisplayName("a null rule reference still resolves the plain action")
    void nullRuleReferenceIsNotAFailure() {
        // Nothing guarantees a rule reference on a supervisor's edited plan.
        assertThat(InstructionCatalogue.instructionCodeFor(PolicyActionCode.STOP_WORK, null))
                .contains("STOP_WORK");
    }

    @Test
    @DisplayName("every code the model may produce has an instruction code")
    void everyAllowlistedActionResolves() {
        /*
         * Mirrors ml-service agent/validation.py ALLOWED_ACTION_CODES. If the agent's allowlist
         * grows and this list does not, the new action dispatches with no code and silently
         * reaches workers as English -- recoverable, but only noticed by someone reading in a
         * non-English locale.
         */
        for (String code : new String[]{
                "STOP_WORK", "RESUME_WORK", "REST_10_MIN_HOURLY", "REST_15_MIN_HOURLY",
                "HYDRATE_HOURLY", "HYDRATE_REGULARLY", "SHADE_RECOVERY",
                "RESCHEDULE_HEAVY_WORK", "ROTATE_TO_LIGHT_DUTY", "CLOSE_MONITORING"}) {
            assertThat(InstructionCatalogue.instructionCodeFor(code, HEAT_RULE))
                    .as("instruction code for %s", code)
                    .isNotEmpty();
        }
    }

    @Test
    @DisplayName("every instruction code is a code a client could be asked to translate")
    void instructionCodesAreSelfConsistent() {
        Optional<String> lightning =
                InstructionCatalogue.instructionCodeFor(PolicyActionCode.STOP_WORK, LIGHTNING_RULE);

        assertThat(lightning).isPresent();
        assertThat(InstructionCatalogue.instructionCodes()).contains(lightning.orElseThrow());
    }
}
