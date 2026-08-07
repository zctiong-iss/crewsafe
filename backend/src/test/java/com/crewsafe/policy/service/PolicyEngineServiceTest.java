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
                .wbgtThresholdUnacclimatisedLight(25.0)
                .wbgtThresholdUnacclimatisedModerate(23.0)
                .wbgtThresholdUnacclimatisedHeavy(21.0)
                // Partial thresholds
                .wbgtThresholdPartialLight(26.0)
                .wbgtThresholdPartialModerate(24.0)
                .wbgtThresholdPartialHeavy(22.0)
                // Full thresholds
                .wbgtThresholdFullLight(28.0)
                .wbgtThresholdFullModerate(26.0)
                .wbgtThresholdFullHeavy(24.0)
                // Emergency
                .wbgtEmergencyStop(30.0)
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
            assertThat(decision.action()).isEqualTo(PolicyDecision.Action.CONTINUE);
            assertThat(decision.restRecommendation()).isEqualTo(RestRecommendation.NONE);
            assertThat(decision.reasoning()).contains("below threshold");
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
            assertThat(decision.action()).isEqualTo(PolicyDecision.Action.EXTENDED_REST);
            assertThat(decision.restRecommendation()).isEqualTo(RestRecommendation.EXTENDED);
            assertThat(decision.reasoning()).contains("exceeds threshold");
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
            assertThat(decision.action()).isEqualTo(PolicyDecision.Action.SHORT_REST);
            assertThat(decision.restRecommendation()).isEqualTo(RestRecommendation.SHORT);
        }

        @Test
        @DisplayName("WBGT at exact threshold → CONTINUE")
        void wbgtAtExactThreshold() {
            // Given: WBGT exactly at threshold
            var decision = policyEngine.evaluate(
                    siteId,
                    25.0,
                    HeatRestPolicy.WorkIntensity.LIGHT,
                    1  // Unacclimatised
            );

            // Then: Not exceeding, so continue
            assertThat(decision.action()).isEqualTo(PolicyDecision.Action.SHORT_REST);
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

            assertThat(decision.action()).isEqualTo(PolicyDecision.Action.SHORT_REST);
            assertThat(decision.reasoning()).contains("UNACCLIMATISED");
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

            assertThat(decision.action()).isEqualTo(PolicyDecision.Action.SHORT_REST);
            assertThat(decision.reasoning()).contains("PARTIAL");
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

            assertThat(decision.action()).isEqualTo(PolicyDecision.Action.CONTINUE);
            assertThat(decision.reasoning()).contains("FULL");
        }
    }

    @Nested
    @DisplayName("Emergency stop conditions")
    class EmergencyStop {

        @Test
        @DisplayName("WBGT >= 30°C → STOP_WORK (emergency)")
        void emergencyStopExactThreshold() {
            var decision = policyEngine.evaluate(
                    siteId,
                    30.0,
                    HeatRestPolicy.WorkIntensity.LIGHT,
                    7
            );

            assertThat(decision.action()).isEqualTo(PolicyDecision.Action.STOP_WORK);
            assertThat(decision.restRecommendation()).isEqualTo(RestRecommendation.EMERGENCY);
            assertThat(decision.reasoning()).contains("emergency stop");
        }

        @Test
        @DisplayName("WBGT > 30°C → STOP_WORK (emergency)")
        void emergencyStopAboveThreshold() {
            var decision = policyEngine.evaluate(
                    siteId,
                    35.0,
                    HeatRestPolicy.WorkIntensity.HEAVY,
                    1
            );

            assertThat(decision.action()).isEqualTo(PolicyDecision.Action.STOP_WORK);
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
        @DisplayName("Decision.requiresRest() returns true for action != CONTINUE")
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
                    siteId, 31.0, HeatRestPolicy.WorkIntensity.LIGHT, 1
            );
            assertThat(emergency.isEmergencyStop()).isTrue();

            var normal = policyEngine.evaluate(
                    siteId, 24.0, HeatRestPolicy.WorkIntensity.LIGHT, 1
            );
            assertThat(normal.isEmergencyStop()).isFalse();
        }
    }
}
