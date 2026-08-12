package com.crewsafe.policy.service;

import com.crewsafe.policy.domain.*;
import com.crewsafe.policy.repository.PolicyVersionRepository;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.weather.domain.WbgtBand;
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
import java.time.LocalDate;
import java.math.BigDecimal;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
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
 * - Per-worker targeting and multi-worker shift merging (SCRUM-118 delta 1)
 * - Granular, translated action codes (SCRUM-118 delta 2)
 * - WbgtBand-typed current/forecast bands (SCRUM-118 delta 3)
 * - Hydration/shade/reschedule/rotate producers (SCRUM-118 delta 4)
 *
 * @author Jemilin Beulah
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("PolicyEngineService")
class PolicyEngineServiceTest {

    private static BigDecimal bd(double value) {
        return BigDecimal.valueOf(value);
    }

    @Mock
    private PolicyVersionRepository policyRepository;

    @Mock
    private AcclimatisationCalculator acclimatisationCalculator;

    private PolicyEngineService policyEngine;
    private PolicyVersion testPolicy;
    private UUID siteId;
    private UUID workerId;

    @BeforeEach
    void setUp() {
        policyEngine = new PolicyEngineService(policyRepository, acclimatisationCalculator);
        siteId = UUID.randomUUID();
        workerId = UUID.randomUUID();

        // Create standard test policy (MOM defaults)
        testPolicy = PolicyVersion.builder()
                .id(UUID.randomUUID())
                .siteId(siteId)
                .versionLabel("MOM-WBGT-2026.1")
                .source("MOM Work-Rest Guidelines 2026")
                .effectiveDate(LocalDate.now())
                .status(PolicyVersionStatus.ACTIVE)
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

        when(policyRepository.findBySiteIdAndStatus(siteId, PolicyVersionStatus.ACTIVE))
                .thenReturn(Optional.of(testPolicy));
    }

    @Nested
    @DisplayName("Happy path - policy evaluation")
    class HappyPath {

        @Test
        @DisplayName("WBGT below threshold → hydrate + shade advisories")
        void wbgtBelowThreshold() {
            // Given: Unacclimatised worker, light work, WBGT 24°C (below 25°C)
            var decision = policyEngine.evaluate(
                    siteId, workerId, 24.0, WorkIntensity.LIGHT, 1
            );

            // Then: no mandatory actions, routine advisories only
            assertThat(decision.mandatoryActions()).isEmpty();
            assertThat(decision.advisoryActions())
                    .extracting(PolicyDecision.PolicyAction::code)
                    .containsExactly(PolicyActionCode.HYDRATE_REGULARLY, PolicyActionCode.SHADE_RECOVERY);
            assertThat(decision.advisoryActions().get(0).reasoning()).contains("below threshold");
        }

        @Test
        @DisplayName("WBGT exceeds threshold (unacclimatised, heavy) → REST_15_MIN_HOURLY")
        void wbgtExceedsThresholdUnacclimatisedHeavy() {
            // Given: Unacclimatised worker, heavy work, WBGT 22°C (exceeds 21°C threshold)
            var decision = policyEngine.evaluate(
                    siteId, workerId, 22.0, WorkIntensity.HEAVY, 1  // Day 1 = unacclimatised
            );

            // Then: the more severe rest tier, paired with mandatory hydration
            assertThat(decision.mandatoryActions())
                    .extracting(PolicyDecision.PolicyAction::code)
                    .containsExactly(PolicyActionCode.REST_15_MIN_HOURLY, PolicyActionCode.HYDRATE_HOURLY);
            assertThat(decision.mandatoryActions().get(0).reasoning()).contains("exceeds threshold");
            // Heavy + unacclimatised also gets the rotate-to-light-duty advisory
            assertThat(decision.advisoryActions())
                    .extracting(PolicyDecision.PolicyAction::code)
                    .contains(PolicyActionCode.ROTATE_TO_LIGHT_DUTY, PolicyActionCode.RESCHEDULE_HEAVY_WORK);
        }

        @Test
        @DisplayName("WBGT exceeds threshold (fully acclimatised) → REST_10_MIN_HOURLY")
        void wbgtExceedsThresholdFullyAcclimatised() {
            // Given: Fully acclimatised worker, heavy work, WBGT 25°C (exceeds 24°C threshold)
            var decision = policyEngine.evaluate(
                    siteId, workerId, 25.0, WorkIntensity.HEAVY, 7  // Day 7+ = fully acclimatised
            );

            // Then: the standard rest tier
            assertThat(decision.mandatoryActions().get(0).code()).isEqualTo(PolicyActionCode.REST_10_MIN_HOURLY);
        }

        @Test
        @DisplayName("WBGT at exact threshold → REST_10_MIN_HOURLY")
        void wbgtAtExactThreshold() {
            // Given: WBGT exactly at threshold, light work (not severe)
            var decision = policyEngine.evaluate(
                    siteId, workerId, 25.0, WorkIntensity.LIGHT, 1  // Unacclimatised
            );

            // Then: At exact threshold triggers rest
            assertThat(decision.mandatoryActions().get(0).code()).isEqualTo(PolicyActionCode.REST_10_MIN_HOURLY);
        }
    }

    @Nested
    @DisplayName("Acclimatisation level effects")
    class AcclimatisationEffects {

        @Test
        @DisplayName("Day 1-3: Unacclimatised")
        void unacclimatisedPhase() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 25.5, WorkIntensity.LIGHT, 1
            );

            assertThat(decision.mandatoryActions()).isNotEmpty();
            assertThat(decision.mandatoryActions().get(0).code()).isEqualTo(PolicyActionCode.REST_10_MIN_HOURLY);
            assertThat(decision.mandatoryActions().get(0).ruleReference()).isNotNull();
        }

        @Test
        @DisplayName("Day 4-6: Partial acclimatisation")
        void partialAcclimatisationPhase() {
            // WBGT 24°C exceeds partial threshold of 22 for heavy work
            var decision = policyEngine.evaluate(
                    siteId, workerId, 24.0, WorkIntensity.HEAVY, 4
            );

            assertThat(decision.mandatoryActions()).isNotEmpty();
            // PARTIAL is not UNACCLIMATISED, so not the severe tier even on heavy work
            assertThat(decision.mandatoryActions().get(0).code()).isEqualTo(PolicyActionCode.REST_10_MIN_HOURLY);
        }

        @Test
        @DisplayName("Day 7+: Full acclimatisation")
        void fullAcclimatisationPhase() {
            // WBGT 27°C below full threshold of 28 for light work
            var decision = policyEngine.evaluate(
                    siteId, workerId, 27.0, WorkIntensity.LIGHT, 7
            );

            assertThat(decision.mandatoryActions()).isEmpty();
            assertThat(decision.advisoryActions()).isNotEmpty();
            assertThat(decision.advisoryActions().get(0).code()).isEqualTo(PolicyActionCode.HYDRATE_REGULARLY);
        }
    }

    @Nested
    @DisplayName("Emergency stop conditions")
    class EmergencyStop {

        @Test
        @DisplayName("WBGT >= 33°C → STOP_WORK (emergency, MOM Band 3)")
        void emergencyStopExactThreshold() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 33.0, WorkIntensity.LIGHT, 7
            );

            assertThat(decision.mandatoryActions())
                    .extracting(PolicyDecision.PolicyAction::code)
                    .containsExactly(PolicyActionCode.STOP_WORK, PolicyActionCode.CLOSE_MONITORING);
            assertThat(decision.mandatoryActions().get(0).reasoning()).contains("emergency stop");
        }

        @Test
        @DisplayName("WBGT > 33°C → STOP_WORK (emergency, MOM Band 3)")
        void emergencyStopAboveThreshold() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 35.0, WorkIntensity.HEAVY, 1
            );

            assertThat(decision.mandatoryActions().get(0).code()).isEqualTo(PolicyActionCode.STOP_WORK);
            assertThat(decision.isEmergencyStop()).isTrue();
        }
    }

    @Nested
    @DisplayName("Input validation")
    class InputValidation {

        @Test
        @DisplayName("Null worker id → IllegalArgumentException")
        void nullWorkerId() {
            assertThatThrownBy(() ->
                    policyEngine.evaluate(siteId, null, 25.0, WorkIntensity.LIGHT, 1)
            ).isInstanceOf(IllegalArgumentException.class)
             .hasMessageContaining("workerId");
        }

        @Test
        @DisplayName("Null WBGT → IllegalArgumentException")
        void nullWbgt() {
            assertThatThrownBy(() ->
                    policyEngine.evaluate(siteId, workerId, null, WorkIntensity.LIGHT, 1)
            ).isInstanceOf(IllegalArgumentException.class)
             .hasMessageContaining("WBGT");
        }

        @Test
        @DisplayName("WBGT < 15°C → IllegalArgumentException")
        void wbgtBelowMinimum() {
            assertThatThrownBy(() ->
                    policyEngine.evaluate(siteId, workerId, 10.0, WorkIntensity.LIGHT, 1)
            ).isInstanceOf(IllegalArgumentException.class)
             .hasMessageContaining("15");
        }

        @Test
        @DisplayName("WBGT > 40°C → IllegalArgumentException")
        void wbgtAboveMaximum() {
            assertThatThrownBy(() ->
                    policyEngine.evaluate(siteId, workerId, 45.0, WorkIntensity.LIGHT, 1)
            ).isInstanceOf(IllegalArgumentException.class)
             .hasMessageContaining("40");
        }

        @Test
        @DisplayName("Null intensity → IllegalArgumentException")
        void nullIntensity() {
            assertThatThrownBy(() ->
                    policyEngine.evaluate(siteId, workerId, 25.0, null, 1)
            ).isInstanceOf(IllegalArgumentException.class)
             .hasMessageContaining("intensity");
        }

        @Test
        @DisplayName("Acclimatisation day < 1 → IllegalArgumentException")
        void acclimatisationDayBelowMinimum() {
            assertThatThrownBy(() ->
                    policyEngine.evaluate(siteId, workerId, 25.0, WorkIntensity.LIGHT, 0)
            ).isInstanceOf(IllegalArgumentException.class)
             .hasMessageContaining("1");
        }

        @Test
        @DisplayName("Acclimatisation day > 365 → IllegalArgumentException")
        void acclimatisationDayAboveMaximum() {
            assertThatThrownBy(() ->
                    policyEngine.evaluate(siteId, workerId, 25.0, WorkIntensity.LIGHT, 366)
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
            when(policyRepository.findBySiteIdAndStatus(unknownSite, PolicyVersionStatus.ACTIVE))
                    .thenReturn(Optional.empty());

            assertThatThrownBy(() ->
                    policyEngine.evaluate(unknownSite, workerId, 25.0, WorkIntensity.LIGHT, 1)
            ).isInstanceOf(NoSuchElementException.class)
             .hasMessageContaining("No policy");
        }
    }

    @Nested
    @DisplayName("Decision properties")
    class DecisionProperties {

        @Test
        @DisplayName("Decision.requiresRest() returns true when mandatory actions exist")
        void requiresRestProperty() {
            var continueDecision = policyEngine.evaluate(
                    siteId, workerId, 20.0, WorkIntensity.LIGHT, 7
            );
            assertThat(continueDecision.requiresRest()).isFalse();

            var restDecision = policyEngine.evaluate(
                    siteId, workerId, 25.0, WorkIntensity.HEAVY, 1
            );
            assertThat(restDecision.requiresRest()).isTrue();
        }

        @Test
        @DisplayName("Decision.isEmergencyStop() returns true only for STOP_WORK")
        void isEmergencyStopProperty() {
            var emergency = policyEngine.evaluate(
                    siteId, workerId, 33.0, WorkIntensity.LIGHT, 1
            );
            assertThat(emergency.isEmergencyStop()).isTrue();

            var normal = policyEngine.evaluate(
                    siteId, workerId, 24.0, WorkIntensity.LIGHT, 1
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
                    siteId, workerId, 25.0, WorkIntensity.LIGHT, 1
            );

            assertThat(decision.policyVersion()).isNotBlank();
            assertThat(decision.currentBand()).isNotNull();
            assertThat(decision.forecastBand()).isNotNull();
        }

        @Test
        @DisplayName("PolicyAction includes ruleReference and appliesTo[]")
        void policyActionStructure() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 25.0, WorkIntensity.LIGHT, 1
            );

            var action = decision.mandatoryActions().get(0);
            assertThat(action.ruleReference()).isNotBlank();
            assertThat(action.appliesTo()).isNotEmpty();
            assertThat(action.reasoning()).isNotBlank();
        }

        @Test
        @DisplayName("appliesTo[] carries the evaluated worker's id, not condition tags")
        void appliesToCarriesWorkerId() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 25.0, WorkIntensity.HEAVY, 1
            );

            assertThat(decision.mandatoryActions().get(0).appliesTo())
                    .containsExactly(workerId.toString());
        }

        @Test
        @DisplayName("Rule references distinguish between policies")
        void ruleReferences() {
            // Emergency stop has specific rule
            var emergency = policyEngine.evaluate(
                    siteId, workerId, 33.0, WorkIntensity.LIGHT, 1
            );
            assertThat(emergency.mandatoryActions().get(0).ruleReference())
                    .isEqualTo("EMERGENCY_STOP_RULE");

            // Regular rest has different rule
            var rest = policyEngine.evaluate(
                    siteId, workerId, 25.0, WorkIntensity.LIGHT, 1
            );
            assertThat(rest.mandatoryActions().get(0).ruleReference())
                    .isNotEqualTo("EMERGENCY_STOP_RULE");
        }
    }

    @Nested
    @DisplayName("WBGT band determination (SCRUM-118 delta 3)")
    class BandDetermination {

        @Test
        @DisplayName("30.9°C → BELOW_31")
        void belowThirtyOne() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 30.9, WorkIntensity.LIGHT, 200
            );
            assertThat(decision.currentBand()).isEqualTo(WbgtBand.BELOW_31);
        }

        @Test
        @DisplayName("31.5°C → 31_TO_BELOW_32")
        void thirtyOneToBelowThirtyTwo() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 31.5, WorkIntensity.LIGHT, 200
            );
            assertThat(decision.currentBand()).isEqualTo(WbgtBand.BAND_31_TO_BELOW_32);
        }

        @Test
        @DisplayName("32.5°C → 32_TO_BELOW_33")
        void thirtyTwoToBelowThirtyThree() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 32.5, WorkIntensity.LIGHT, 200
            );
            assertThat(decision.currentBand()).isEqualTo(WbgtBand.BAND_32_TO_BELOW_33);
        }

        @Test
        @DisplayName("33.5°C → 33_AND_ABOVE (also trips this policy's emergency stop)")
        void thirtyThreeAndAbove() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 33.5, WorkIntensity.LIGHT, 200
            );
            assertThat(decision.currentBand()).isEqualTo(WbgtBand.BAND_33_AND_ABOVE);
        }

        @Test
        @DisplayName("Band is independent of this site's configured rest thresholds")
        void bandIndependentOfSiteThresholds() {
            // 28°C meets this site's FULL/LIGHT threshold (28°C, i.e. rest is due) but is
            // nowhere near the global 31°C band boundary — the two axes disagree, correctly.
            var decision = policyEngine.evaluate(
                    siteId, workerId, 28.0, WorkIntensity.LIGHT, 7
            );
            assertThat(decision.mandatoryActions()).isNotEmpty(); // site threshold says rest
            assertThat(decision.currentBand()).isEqualTo(WbgtBand.BELOW_31); // band disagrees, correctly
        }
    }

    @Nested
    @DisplayName("evaluateForShift — multi-worker targeting and merging (SCRUM-118 delta 1)")
    class MultiWorkerShiftEvaluation {

        @Test
        @DisplayName("Two workers landing on the same action code are merged into one action")
        void mergesWorkersOnSameCode() {
            UUID workerA = UUID.randomUUID();
            UUID workerB = UUID.randomUUID();
            var assignments = List.of(
                    new ShiftAssignment(UUID.randomUUID(), workerA, "Task A", Intensity.HEAVY, 1),
                    new ShiftAssignment(UUID.randomUUID(), workerB, "Task B", Intensity.HEAVY, 1)
            );

            var decision = policyEngine.evaluateForShift(siteId, 22.0, assignments);

            var restAction = decision.mandatoryActions().stream()
                    .filter(a -> a.code().equals(PolicyActionCode.REST_15_MIN_HOURLY))
                    .findFirst().orElseThrow();
            assertThat(restAction.appliesTo()).containsExactlyInAnyOrder(
                    workerA.toString(), workerB.toString());
        }

        @Test
        @DisplayName("Workers on different codes are not merged")
        void keepsDifferentCodesSeparate() {
            UUID lightWorker = UUID.randomUUID();
            UUID heavyWorker = UUID.randomUUID();
            var assignments = List.of(
                    // Fully acclimatised, light work — WBGT 25 is below the FULL/LIGHT threshold (28)
                    new ShiftAssignment(UUID.randomUUID(), lightWorker, null, Intensity.LIGHT, 7),
                    // Unacclimatised, heavy work — WBGT 25 exceeds the UNACCLIMATISED/HEAVY threshold (21)
                    new ShiftAssignment(UUID.randomUUID(), heavyWorker, null, Intensity.HEAVY, 1)
            );

            var decision = policyEngine.evaluateForShift(siteId, 25.0, assignments);

            assertThat(decision.mandatoryActions())
                    .extracting(PolicyDecision.PolicyAction::code)
                    .contains(PolicyActionCode.REST_15_MIN_HOURLY);
            assertThat(decision.advisoryActions())
                    .extracting(PolicyDecision.PolicyAction::code)
                    .contains(PolicyActionCode.HYDRATE_REGULARLY);

            var restAction = decision.mandatoryActions().stream()
                    .filter(a -> a.code().equals(PolicyActionCode.REST_15_MIN_HOURLY))
                    .findFirst().orElseThrow();
            assertThat(restAction.appliesTo()).containsExactly(heavyWorker.toString());
        }

        @Test
        @DisplayName("Missing acclimatisationDay defaults to day 1 (unacclimatised), not the lenient case")
        void nullAcclimatisationDayDefaultsToStrictest() {
            UUID worker = UUID.randomUUID();
            var assignments = List.of(
                    new ShiftAssignment(UUID.randomUUID(), worker, null, Intensity.HEAVY, null)
            );

            // WBGT 22 exceeds the UNACCLIMATISED/HEAVY threshold (21) but not PARTIAL (22) or FULL (24)
            var decision = policyEngine.evaluateForShift(siteId, 22.0, assignments);

            assertThat(decision.mandatoryActions())
                    .extracting(PolicyDecision.PolicyAction::code)
                    .contains(PolicyActionCode.REST_15_MIN_HOURLY); // the severe, unacclimatised tier
        }

        @Test
        @DisplayName("Empty assignment list returns the current band with no actions")
        void emptyAssignmentsYieldsNoActions() {
            var decision = policyEngine.evaluateForShift(siteId, 20.0, List.of());

            assertThat(decision.mandatoryActions()).isEmpty();
            assertThat(decision.advisoryActions()).isEmpty();
            assertThat(decision.currentBand()).isEqualTo(WbgtBand.BELOW_31);
        }

        @Test
        @DisplayName("Empty assignment list still requires a configured policy")
        void emptyAssignmentsStillRequiresPolicy() {
            UUID unknownSite = UUID.randomUUID();
            when(policyRepository.findBySiteIdAndStatus(unknownSite, PolicyVersionStatus.ACTIVE))
                    .thenReturn(Optional.empty());

            assertThatThrownBy(() -> policyEngine.evaluateForShift(unknownSite, 20.0, List.of()))
                    .isInstanceOf(NoSuchElementException.class)
                    .hasMessageContaining("No policy");
        }
    }

    @Nested
    @DisplayName("Additional action producers (SCRUM-118 delta 4)")
    class AdditionalActionProducers {

        @Test
        @DisplayName("Rest-required branch always pairs with mandatory hydration")
        void restAlwaysPairsWithHydration() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 25.0, WorkIntensity.HEAVY, 7
            );
            assertThat(decision.mandatoryActions())
                    .extracting(PolicyDecision.PolicyAction::code)
                    .contains(PolicyActionCode.HYDRATE_HOURLY);
        }

        @Test
        @DisplayName("Heavy-intensity work above threshold gets an advisory reschedule")
        void heavyWorkGetsRescheduleAdvisory() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 25.0, WorkIntensity.HEAVY, 7
            );
            assertThat(decision.advisoryActions())
                    .extracting(PolicyDecision.PolicyAction::code)
                    .contains(PolicyActionCode.RESCHEDULE_HEAVY_WORK);
        }

        @Test
        @DisplayName("Light-intensity work above threshold does not get the reschedule advisory")
        void lightWorkDoesNotGetRescheduleAdvisory() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 25.0, WorkIntensity.LIGHT, 1
            );
            // Assert the advisory list is non-empty (CLOSE_MONITORING still applies, since rest
            // is required) rather than just asserting an absence, so this test would fail loudly
            // if a future change made advisoryActions empty for an unrelated reason.
            assertThat(decision.advisoryActions())
                    .extracting(PolicyDecision.PolicyAction::code)
                    .containsExactly(PolicyActionCode.CLOSE_MONITORING);
        }

        @Test
        @DisplayName("Safe range gets both hydration and shade advisories")
        void safeRangeGetsHydrationAndShade() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 20.0, WorkIntensity.LIGHT, 7
            );
            assertThat(decision.advisoryActions())
                    .extracting(PolicyDecision.PolicyAction::code)
                    .containsExactlyInAnyOrder(PolicyActionCode.HYDRATE_REGULARLY, PolicyActionCode.SHADE_RECOVERY);
        }

        @Test
        @DisplayName("Emergency stop pairs with mandatory close monitoring")
        void emergencyStopPairsWithMonitoring() {
            var decision = policyEngine.evaluate(
                    siteId, workerId, 33.0, WorkIntensity.LIGHT, 7
            );
            assertThat(decision.mandatoryActions())
                    .extracting(PolicyDecision.PolicyAction::code)
                    .contains(PolicyActionCode.CLOSE_MONITORING);
        }
    }
}
