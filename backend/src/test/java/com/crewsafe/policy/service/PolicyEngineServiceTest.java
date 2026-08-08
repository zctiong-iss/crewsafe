package com.crewsafe.policy.service;

import com.crewsafe.policy.domain.*;
import com.crewsafe.policy.repository.PolicyConfigRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.math.BigDecimal;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Unit tests for PolicyEngineService.
 *
 * Tests cover:
 * - Policy evaluation logic (WBGT thresholds)
 * - Acclimatisation level effects
 * - Work intensity modifiers
 * - Emergency stop conditions
 * - Input validation
 * - Missing policy handling
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("PolicyEngineService")
class PolicyEngineServiceTest {

    private static BigDecimal bd(double value) {
        return BigDecimal.valueOf(value);
    }

    @Mock
    private PolicyConfigRepository policyRepository;

    @Mock
    private AcclimatisationCalculator acclimatisationCalculator;

    private PolicyEngineService policyEngine;
    private HeatRestPolicy testPolicy;
    private UUID siteId;

    @BeforeEach
    void setUp() {
        policyEngine = new PolicyEngineService(policyRepository, acclimatisationCalculator);
        siteId = UUID.randomUUID();

        // Create standard test policy (MOM defaults)
        testPolicy = HeatRestPolicy.builder()
                .id(UUID.randomUUID())
                .siteId(siteId)
                // Unacclimatised thresholds
                .wbgtThresholdUnacclimatisedLight(bd(25.0))
                .wbgtThresholdUnacclimatisedModerate(bd(23.0))
                .wbgtThresholdUnacclimatisedHeavy(bd(21.0))
                // Partial thresholds
                .wbgtThresholdPartialLight(bd(26.0))
                .wbgtThresholdPartialModerate(bd(24.0))
                .wbgtThresholdPartialHeavy(bd(22.0))
                // Full thresholds
                .wbgtThresholdFullLight(bd(28.0))
                .wbgtThresholdFullModerate(bd(26.0))
                .wbgtThresholdFullHeavy(bd(24.0))
                // Emergency (MOM Band 3: WBGT >= 33°C)
                .wbgtEmergencyStop(bd(33.0))
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();

        when(policyRepository.findBySiteId(siteId)).thenReturn(Optional.of(testPolicy));
    }

    @Nested
    @DisplayName("Happy path - policy evaluation")
    class HappyPath {

        @Test
        @DisplayName("WBGT below threshold → CONTINUE")
        void wbgtBelowThreshold() {
            // Given: Unacclimatised worker, light work, WBGT 24°C (below 25°C)
            var decision = policyEngine.evaluate(
                    siteId,
                    24.0,
                    HeatRestPolicy.WorkIntensity.LIGHT,
                    1
            );

            // Then: Continue working
            assertThat(decision.required()).isEmpty();
            assertThat(decision.advised()).isNotEmpty();
            assertThat(decision.advised().get(0).action()).isEqualTo(PolicyDecision.Action.CONTINUE.name());
            assertThat(decision.advised().get(0).reasoning()).contains("below threshold");
        }

        @Test
        @DisplayName("WBGT exceeds threshold (unacclimatised, heavy) → EXTENDED_REST")
        void wbgtExceedsThresholdUnacclimatisedHeavy() {
            // Given: Unacclimatised worker, heavy work, WBGT 22°C (exceeds 21°C threshold)
            var decision = policyEngine.evaluate(
                    siteId,
                    22.0,
                    HeatRestPolicy.WorkIntensity.HEAVY,
                    1  // Day 1 = unacclimatised
            );

            // Then: Extended rest recommended
            assertThat(decision.required()).isNotEmpty();
            assertThat(decision.required().get(0).action()).isEqualTo(PolicyDecision.Action.EXTENDED_REST.name());
            assertThat(decision.required().get(0).reasoning()).contains("exceeds threshold");
        }

        @Test
        @DisplayName("WBGT exceeds threshold (fully acclimatised) → SHORT_REST")
        void wbgtExceedsThresholdFullyAcclimatised() {
            // Given: Fully acclimatised worker, heavy work, WBGT 25°C (exceeds 24°C threshold)
            var decision = policyEngine.evaluate(
                    siteId,
                    25.0,
                    HeatRestPolicy.WorkIntensity.HEAVY,
                    7  // Day 7+ = fully acclimatised
            );

            // Then: Short rest recommended
            assertThat(decision.required()).isNotEmpty();
            assertThat(decision.required().get(0).action()).isEqualTo(PolicyDecision.Action.SHORT_REST.name());
        }

        @Test
        @DisplayName("WBGT at exact threshold → SHORT_REST")
        void wbgtAtExactThreshold() {
            // Given: WBGT exactly at threshold
            var decision = policyEngine.evaluate(
                    siteId,
                    25.0,
                    HeatRestPolicy.WorkIntensity.LIGHT,
                    1  // Unacclimatised
            );

            // Then: At exact threshold triggers rest
            assertThat(decision.required()).isNotEmpty();
            assertThat(decision.required().get(0).action()).isEqualTo(PolicyDecision.Action.SHORT_REST.name());
        }
    }

    @Nested
    @DisplayName("Acclimatisation level effects")
    class AcclimatisationEffects {

        @Test
        @DisplayName("Day 1-3: Unacclimatised")
        void unacclimatisedPhase() {
            var decision = policyEngine.evaluate(
                    siteId,
                    25.5,
                    HeatRestPolicy.WorkIntensity.LIGHT,
                    1
            );

            assertThat(decision.required()).isNotEmpty();
            assertThat(decision.required().get(0).action()).isEqualTo(PolicyDecision.Action.SHORT_REST.name());
            assertThat(decision.required().get(0).ruleReference()).isNotNull();
        }

        @Test
        @DisplayName("Day 4-6: Partial acclimatisation")
        void partialAcclimatisationPhase() {
            // WBGT 24°C exceeds partial threshold of 23 for heavy work
            var decision = policyEngine.evaluate(
                    siteId,
                    24.0,
                    HeatRestPolicy.WorkIntensity.HEAVY,
                    4
            );

            assertThat(decision.required()).isNotEmpty();
            assertThat(decision.required().get(0).action()).isEqualTo(PolicyDecision.Action.SHORT_REST.name());
        }

        @Test
        @DisplayName("Day 7+: Full acclimatisation")
        void fullAcclimatisationPhase() {
            // WBGT 27°C below full threshold of 28 for light work
            var decision = policyEngine.evaluate(
                    siteId,
                    27.0,
                    HeatRestPolicy.WorkIntensity.LIGHT,
                    7
            );

            assertThat(decision.required()).isEmpty();
            assertThat(decision.advised()).isNotEmpty();
            assertThat(decision.advised().get(0).action()).isEqualTo(PolicyDecision.Action.CONTINUE.name());
        }
    }

    @Nested
    @DisplayName("Emergency stop conditions")
    class EmergencyStop {

        @Test
        @DisplayName("WBGT >= 33°C → STOP_WORK (emergency, MOM Band 3)")
        void emergencyStopExactThreshold() {
            var decision = policyEngine.evaluate(
                    siteId,
                    33.0,
                    HeatRestPolicy.WorkIntensity.LIGHT,
                    7
            );

            assertThat(decision.required()).isNotEmpty();
            assertThat(decision.required().get(0).action()).isEqualTo(PolicyDecision.Action.STOP_WORK.name());
            assertThat(decision.required().get(0).reasoning()).contains("emergency stop");
        }

        @Test
        @DisplayName("WBGT > 33°C → STOP_WORK (emergency, MOM Band 3)")
        void emergencyStopAboveThreshold() {
            var decision = policyEngine.evaluate(
                    siteId,
                    35.0,
                    HeatRestPolicy.WorkIntensity.HEAVY,
                    1
            );

            assertThat(decision.required()).isNotEmpty();
            assertThat(decision.required().get(0).action()).isEqualTo(PolicyDecision.Action.STOP_WORK.name());
            assertThat(decision.isEmergencyStop()).isTrue();
        }
    }

    @Nested
    @DisplayName("Input validation")
    class InputValidation {

        @Test
        @DisplayName("Null WBGT → IllegalArgumentException")
        void nullWbgt() {
            assertThatThrownBy(() ->
                    policyEngine.evaluate(siteId, null, HeatRestPolicy.WorkIntensity.LIGHT, 1)
            ).isInstanceOf(IllegalArgumentException.class)
             .hasMessageContaining("WBGT");
        }

        @Test
        @DisplayName("WBGT < 15°C → IllegalArgumentException")
        void wbgtBelowMinimum() {
            assertThatThrownBy(() ->
                    policyEngine.evaluate(siteId, 10.0, HeatRestPolicy.WorkIntensity.LIGHT, 1)
            ).isInstanceOf(IllegalArgumentException.class)
             .hasMessageContaining("15");
        }

        @Test
        @DisplayName("WBGT > 40°C → IllegalArgumentException")
        void wbgtAboveMaximum() {
            assertThatThrownBy(() ->
                    policyEngine.evaluate(siteId, 45.0, HeatRestPolicy.WorkIntensity.LIGHT, 1)
            ).isInstanceOf(IllegalArgumentException.class)
             .hasMessageContaining("40");
        }

        @Test
        @DisplayName("Null intensity → IllegalArgumentException")
        void nullIntensity() {
            assertThatThrownBy(() ->
                    policyEngine.evaluate(siteId, 25.0, null, 1)
            ).isInstanceOf(IllegalArgumentException.class)
             .hasMessageContaining("intensity");
        }

        @Test
        @DisplayName("Acclimatisation day < 1 → IllegalArgumentException")
        void acclimatisationDayBelowMinimum() {
            assertThatThrownBy(() ->
                    policyEngine.evaluate(siteId, 25.0, HeatRestPolicy.WorkIntensity.LIGHT, 0)
            ).isInstanceOf(IllegalArgumentException.class)
             .hasMessageContaining("1");
        }

        @Test
        @DisplayName("Acclimatisation day > 365 → IllegalArgumentException")
        void acclimatisationDayAboveMaximum() {
            assertThatThrownBy(() ->
                    policyEngine.evaluate(siteId, 25.0, HeatRestPolicy.WorkIntensity.LIGHT, 366)
            ).isInstanceOf(IllegalArgumentException.class)
             .hasMessageContaining("365");
        }
    }

    @Nested
    @DisplayName("Policy not found")
    class PolicyNotFound {

        @Test
        @DisplayName("No policy for site → NoSuchElementException")
        void policyNotConfigured() {
            UUID unknownSite = UUID.randomUUID();
            when(policyRepository.findBySiteId(unknownSite)).thenReturn(Optional.empty());

            assertThatThrownBy(() ->
                    policyEngine.evaluate(unknownSite, 25.0, HeatRestPolicy.WorkIntensity.LIGHT, 1)
            ).isInstanceOf(NoSuchElementException.class)
             .hasMessageContaining("No policy");
        }
    }

    @Nested
    @DisplayName("Decision properties")
    class DecisionProperties {

        @Test
        @DisplayName("Decision.requiresRest() returns true when required actions exist")
        void requiresRestProperty() {
            var continueDecision = policyEngine.evaluate(
                    siteId, 20.0, HeatRestPolicy.WorkIntensity.LIGHT, 7
            );
            assertThat(continueDecision.requiresRest()).isFalse();

            var restDecision = policyEngine.evaluate(
                    siteId, 25.0, HeatRestPolicy.WorkIntensity.HEAVY, 1
            );
            assertThat(restDecision.requiresRest()).isTrue();
        }

        @Test
        @DisplayName("Decision.isEmergencyStop() returns true only for STOP_WORK")
        void isEmergencyStopProperty() {
            var emergency = policyEngine.evaluate(
                    siteId, 33.0, HeatRestPolicy.WorkIntensity.LIGHT, 1
            );
            assertThat(emergency.isEmergencyStop()).isTrue();

            var normal = policyEngine.evaluate(
                    siteId, 24.0, HeatRestPolicy.WorkIntensity.LIGHT, 1
            );
            assertThat(normal.isEmergencyStop()).isFalse();
        }
    }

    @Nested
    @DisplayName("PolicyDecision record structure")
    class RecordStructure {

        @Test
        @DisplayName("Decision includes policyVersion, currentBand, forecastBand")
        void decisionMetadata() {
            var decision = policyEngine.evaluate(
                    siteId, 25.0, HeatRestPolicy.WorkIntensity.LIGHT, 1
            );

            assertThat(decision.policyVersion()).isNotBlank();
            assertThat(decision.currentBand()).isNotBlank();
            assertThat(decision.forecastBand()).isNotBlank();
        }

        @Test
        @DisplayName("PolicyAction includes ruleReference and appliesTo[]")
        void policyActionStructure() {
            var decision = policyEngine.evaluate(
                    siteId, 25.0, HeatRestPolicy.WorkIntensity.LIGHT, 1
            );

            var action = decision.required().get(0);
            assertThat(action.ruleReference()).isNotBlank();
            assertThat(action.appliesTo()).isNotEmpty();
            assertThat(action.reasoning()).isNotBlank();
        }

        @Test
        @DisplayName("Band determination: LOW for safe conditions")
        void bandDeterminationLow() {
            var decision = policyEngine.evaluate(
                    siteId, 20.0, HeatRestPolicy.WorkIntensity.LIGHT, 7
            );

            assertThat(decision.currentBand()).isEqualTo("LOW");
        }

        @Test
        @DisplayName("Band determination: MODERATE for elevated WBGT")
        void bandDeterminationModerate() {
            var decision = policyEngine.evaluate(
                    siteId, 26.0, HeatRestPolicy.WorkIntensity.MODERATE, 4
            );

            assertThat(decision.currentBand()).isIn("MODERATE", "HIGH");
        }

        @Test
        @DisplayName("Band determination: CRITICAL for emergency stop")
        void bandDeterminationCritical() {
            var decision = policyEngine.evaluate(
                    siteId, 33.0, HeatRestPolicy.WorkIntensity.LIGHT, 1
            );

            assertThat(decision.currentBand()).isEqualTo("CRITICAL");
        }

        @Test
        @DisplayName("Rule references distinguish between policies")
        void ruleReferences() {
            // Emergency stop has specific rule
            var emergency = policyEngine.evaluate(
                    siteId, 33.0, HeatRestPolicy.WorkIntensity.LIGHT, 1
            );
            assertThat(emergency.required().get(0).ruleReference())
                    .isEqualTo("EMERGENCY_STOP_RULE");

            // Regular rest has different rule
            var rest = policyEngine.evaluate(
                    siteId, 25.0, HeatRestPolicy.WorkIntensity.LIGHT, 1
            );
            assertThat(rest.required().get(0).ruleReference())
                    .isNotEqualTo("EMERGENCY_STOP_RULE");
        }

        @Test
        @DisplayName("appliesTo[] contains worker and condition categories")
        void appliesToCategories() {
            var decision = policyEngine.evaluate(
                    siteId, 25.0, HeatRestPolicy.WorkIntensity.HEAVY, 1
            );

            var appliesTo = decision.required().get(0).appliesTo();
            assertThat(appliesTo).isNotEmpty();
            // Check for at least one condition descriptor
            assertThat(appliesTo.stream().anyMatch(s -> s.contains("work") || s.contains("acclimatised")))
                    .isTrue();
        }
    }
}
