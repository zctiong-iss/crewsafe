package com.crewsafe.operation.service;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.common.error.ErrorCode;
import com.crewsafe.forecast.service.ForecastUnavailableException;
import com.crewsafe.forecast.service.SiteForecastService;
import com.crewsafe.lightning.api.LightningRiskPayload;
import com.crewsafe.lightning.domain.LightningRiskState;
import com.crewsafe.lightning.risk.LightningRiskDerivationService;
import com.crewsafe.mitigation.ai.bedrock.AgentDraftClient;
import com.crewsafe.mitigation.domain.MitigationSuggestion;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.domain.RecommendationEvidence;
import com.crewsafe.operation.repository.RecommendationRepository;
import com.crewsafe.policy.domain.PolicyActionCode;
import com.crewsafe.policy.domain.PolicyDecision;
import com.crewsafe.policy.service.PolicyEngineService;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.repository.ReadinessSubmissionRepository;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.weather.domain.WbgtBand;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import com.crewsafe.weather.service.WeatherQueryService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.lang.reflect.Constructor;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The SCRUM-118 design doc's own verification list, one test per line: an unknown action code
 * or an omitted mandatory action must discard the draft and persist the deterministic plan
 * (AT-11); an unreachable ml-service must still return a plan; active lightning must produce a
 * stop-work plan without any model call; and a stale reading must produce a conservatively
 * worded plan rather than a normal one.
 *
 * <p>The single most important assertion in this file is not any individual outcome — it is
 * that <em>every</em> path ends with a persisted PENDING_APPROVAL recommendation. A supervisor
 * pressing "generate" during a heat event must never receive an error instead of a plan.
 *
 * @author Abu Bakar and Justin Chua
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AgentDraftServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-14T04:00:00Z");
    private static final Instant OBSERVED_AT = Instant.parse("2026-08-14T03:55:00Z");
    private static final UUID SITE_ID = UUID.randomUUID();
    private static final UUID SHIFT_ID = UUID.randomUUID();
    private static final UUID ACTOR_ID = UUID.randomUUID();
    private static final UUID WORKER_ID = UUID.randomUUID();
    private static final String MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0";

    @Mock private ShiftRepository shifts;
    @Mock private ShiftAssignmentRepository shiftAssignments;
    @Mock private ReadinessSubmissionRepository readinessSubmissions;
    @Mock private PolicyEngineService policyEngine;
    @Mock private WeatherQueryService weather;
    @Mock private LightningRiskDerivationService lightning;
    @Mock private SiteForecastService siteForecast;
    @Mock private AgentDraftClient agentDraftClient;
    @Mock private RecommendationRepository recommendations;
    @Mock private AuditService audit;

    private AgentDraftService service;

    @BeforeEach
    void setUp() {
        service = new AgentDraftService(shifts, shiftAssignments, readinessSubmissions, policyEngine,
                weather, lightning, siteForecast, agentDraftClient, new DeterministicPlanBuilder(), recommendations,
                audit, new ObjectMapper().findAndRegisterModules(),
                Clock.fixed(NOW, ZoneOffset.UTC));

        when(shifts.findByIdAndSiteId(SHIFT_ID, SITE_ID)).thenReturn(Optional.of(shift(ShiftStatus.ACTIVE)));
        when(shiftAssignments.findByShiftId(SHIFT_ID)).thenReturn(List.of(
                new ShiftAssignment(SHIFT_ID, WORKER_ID, "Rebar", Intensity.HEAVY, 2)));
        when(readinessSubmissions.findFirstByShiftIdAndWorkerIdOrderBySubmittedAtDescIdDesc(any(), any()))
                .thenReturn(Optional.empty());
        when(weather.findLatestForSite(SITE_ID)).thenReturn(Optional.of(
                new WeatherQueryService.LatestSiteWeather(
                        observation(new BigDecimal("32.50")), WeatherQualityStatus.LIVE)));
        when(lightning.deriveForSite(SITE_ID, NOW)).thenReturn(Optional.of(
                new LightningRiskPayload(LightningRiskState.CLEAR, null, OBSERVED_AT, NOW, WeatherQualityStatus.LIVE)));
        when(policyEngine.evaluateForShift(any(), anyDouble(), anyList())).thenReturn(policyDecision());
        when(recommendations.save(any(Recommendation.class))).thenAnswer(i -> i.getArgument(0));

        // The service defers its audit write to after commit, so registering one needs an active
        // synchronization. Spring supplies that in production and in integration tests; a plain
        // unit test has to open one itself.
        TransactionSynchronizationManager.initSynchronization();
    }

    @AfterEach
    void tearDown() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    /** Fires the callbacks the service deferred, standing in for the transaction committing. */
    private void commit() {
        List.copyOf(TransactionSynchronizationManager.getSynchronizations())
                .forEach(TransactionSynchronization::afterCommit);
    }

    // ----------------------------------------------------------------------------------
    // Happy path
    // ----------------------------------------------------------------------------------

    @Test
    @DisplayName("A valid model draft is persisted as PENDING_APPROVAL and attributed to the model")
    void validDraftIsPersisted() {
        stubDraft(validModelPlan(), false, MODEL_ID);

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();

        assertThat(saved.getStatus()).isEqualTo(Recommendation.RecommendationStatus.PENDING_APPROVAL);
        assertThat(saved.getModelVersion()).isEqualTo(MODEL_ID);
        assertThat(saved.getPolicyVersion()).isEqualTo("MOM-WBGT-2026.1");
        assertThat(saved.getRationale()).isEqualTo("A model-written explanation of the plan.");
        assertThat(persistedCodes(saved)).containsExactlyInAnyOrder(
                PolicyActionCode.REST_15_MIN_HOURLY, PolicyActionCode.HYDRATE_HOURLY,
                PolicyActionCode.CLOSE_MONITORING);
    }

    @Test
    @DisplayName("Never persisted as DRAFT: mobile renders an unknown status as a green 'Approved' pill")
    void neverPersistedAsDraftStatus() {
        stubDraft(validModelPlan(), false, MODEL_ID);

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();

        assertThat(saved.getStatus()).isNotEqualTo(Recommendation.RecommendationStatus.DRAFT);
    }

    // ----------------------------------------------------------------------------------
    // The §8.5 gate (AT-11)
    // ----------------------------------------------------------------------------------

    @Test
    @DisplayName("AT-11: an unknown action code discards the draft and persists the deterministic plan")
    void unknownActionCodeIsDiscarded() {
        stubDraft(List.of(mitigation("TAKE_A_NAP", "MANDATORY", "REST")), false, MODEL_ID);

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();

        assertThat(saved.getModelVersion()).isEqualTo(AgentDraftService.FALLBACK_MODEL_VERSION);
        assertThat(persistedCodes(saved))
                .doesNotContain("TAKE_A_NAP")
                .contains(PolicyActionCode.REST_15_MIN_HOURLY, PolicyActionCode.HYDRATE_HOURLY);
    }

    @Test
    @DisplayName("AT-11: an omitted mandatory action discards the draft, and the fallback restores it")
    void omittedMandatoryActionIsDiscarded() {
        List<MitigationSuggestion> missingHydration = validModelPlan().stream()
                .filter(m -> !PolicyActionCode.HYDRATE_HOURLY.equals(m.actionCode()))
                .toList();
        stubDraft(missingHydration, false, MODEL_ID);

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();

        assertThat(saved.getModelVersion()).isEqualTo(AgentDraftService.FALLBACK_MODEL_VERSION);
        assertThat(persistedCodes(saved)).contains(PolicyActionCode.HYDRATE_HOURLY);
    }

    @Test
    @DisplayName("A discarded draft is never attributed to the model that produced it")
    void discardedDraftIsNotAttributedToTheModel() {
        stubDraft(List.of(mitigation("TAKE_A_NAP", "MANDATORY", "REST")), false, MODEL_ID);

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();

        assertThat(saved.getModelVersion()).isNotEqualTo(MODEL_ID);
    }

    // ----------------------------------------------------------------------------------
    // Degraded paths
    // ----------------------------------------------------------------------------------

    @Test
    @DisplayName("An unreachable ml-service still yields a complete plan, not a 5xx")
    void unreachableMlServiceStillProducesAPlan() {
        when(agentDraftClient.draft(any())).thenThrow(new RuntimeException("connection refused"));

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();

        assertThat(saved.getStatus()).isEqualTo(Recommendation.RecommendationStatus.PENDING_APPROVAL);
        assertThat(saved.getModelVersion()).isEqualTo(AgentDraftService.FALLBACK_MODEL_VERSION);
        assertThat(persistedCodes(saved)).contains(
                PolicyActionCode.REST_15_MIN_HOURLY, PolicyActionCode.HYDRATE_HOURLY);
        assertThat(saved.getRationale()).contains("without the language model");
    }

    @Test
    @DisplayName("A forecast already fetched survives an ml-service outage instead of being discarded")
    void forecastSurvivesAnUnreachableMlService() {
        when(siteForecast.forecast(SITE_ID, 30)).thenReturn(Optional.of(new SiteForecastService.SiteForecast(
                "wbgt", new BigDecimal("34.20"), 30, "wbgt-forecast-v1",
                new BigDecimal("33.00"), new BigDecimal("35.40"), NOW,
                com.crewsafe.forecast.service.ForecastBasis.MODEL, 5L, false)));
        when(agentDraftClient.draft(any())).thenThrow(new RuntimeException("connection refused"));

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();

        // The forecast was fetched successfully before ml-service was ever called, so the
        // deterministic plan this outage produces should not lose it.
        assertThat(evidenceOf(saved).forecastWbgt30m()).isEqualByComparingTo("34.20");
    }

    @Test
    @DisplayName("ml-service's own fallback is kept, but not attributed to the model")
    void mlServiceFallbackIsKeptAndLabelled() {
        stubDraft(validModelPlan(), true, "none");

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();

        assertThat(saved.getModelVersion()).isEqualTo(AgentDraftService.FALLBACK_MODEL_VERSION);
    }

    @Test
    @DisplayName("Active lightning produces a stop-work plan with no model call at all")
    void lightningShortCircuitsTheModel() {
        when(lightning.deriveForSite(SITE_ID, NOW)).thenReturn(Optional.of(new LightningRiskPayload(
                LightningRiskState.STOP_WORK, new BigDecimal("3.10"), OBSERVED_AT, NOW,
                WeatherQualityStatus.LIVE)));

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();

        verify(agentDraftClient, never()).draft(any());
        assertThat(saved.getModelVersion()).isEqualTo(AgentDraftService.LIGHTNING_MODEL_VERSION);
        assertThat(persistedCodes(saved)).containsExactly(PolicyActionCode.STOP_WORK);
        assertThat(saved.getRationale()).contains("overrides the heat-stress assessment");
    }

    @Test
    @DisplayName("The lightning plan names the workers it covers, so an auditor need not rebuild the roster")
    void lightningPlanNamesItsWorkers() {
        when(lightning.deriveForSite(SITE_ID, NOW)).thenReturn(Optional.of(new LightningRiskPayload(
                LightningRiskState.STOP_WORK, new BigDecimal("3.10"), OBSERVED_AT, NOW,
                WeatherQualityStatus.LIVE)));

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();

        assertThat(parse(saved).get(0).appliesTo()).containsExactly(WORKER_ID.toString());
    }

    @Test
    @DisplayName("A stale reading is passed through so the plan is worded as a precaution (§7.1)")
    void staleFreshnessReachesTheAgent() {
        when(weather.findLatestForSite(SITE_ID)).thenReturn(Optional.of(
                new WeatherQueryService.LatestSiteWeather(
                        observation(new BigDecimal("32.50")), WeatherQualityStatus.STALE)));
        stubDraft(validModelPlan(), false, MODEL_ID);

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();

        assertThat(capturedRequest().freshness()).isEqualTo("STALE");
        assertThat(evidenceOf(saved).freshness()).isEqualTo(WeatherQualityStatus.STALE);
    }

    // ----------------------------------------------------------------------------------
    // The evidence block (SCRUM-359)
    // ----------------------------------------------------------------------------------

    @Test
    @DisplayName("Evidence records the conditions at draft time, not at read time")
    void evidenceCapturesConditionsAtDraftTime() {
        stubDraft(validModelPlan(), false, MODEL_ID);

        RecommendationEvidence evidence = evidenceOf(
                service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow());

        assertThat(evidence.observedWbgt()).isEqualByComparingTo("32.50");
        assertThat(evidence.currentBand()).isEqualTo(WbgtBand.BAND_32_TO_BELOW_33);
        assertThat(evidence.observedAt()).isEqualTo(OBSERVED_AT);
        assertThat(evidence.freshness()).isEqualTo(WeatherQualityStatus.LIVE);
        assertThat(evidence.source()).isEqualTo(WeatherSource.NEA);
        assertThat(evidence.stationId()).isEqualTo("S50");
        assertThat(evidence.lightningState()).isEqualTo(LightningRiskState.CLEAR);
    }

    @Test
    @DisplayName("The forecast band is classified from the forecast actually used, not copied from current")
    void forecastBandIsDerivedFromTheForecastValue() {
        // 34.0°C is a different band from the 32.5°C observation. The policy engine still
        // hardcodes forecastBand = currentBand behind its SCRUM-188 TODO, so copying it would
        // report the wrong band the moment SCRUM-281 makes the forecast a real prediction.
        stubDraft(validModelPlan(), false, MODEL_ID, 34.0);

        RecommendationEvidence evidence = evidenceOf(
                service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow());

        assertThat(evidence.currentBand()).isEqualTo(WbgtBand.BAND_32_TO_BELOW_33);
        assertThat(evidence.forecastBand()).isEqualTo(WbgtBand.BAND_33_AND_ABOVE);
    }

    // ----------------------------------------------------------------------------------
    // The forecast (SCRUM-281 wiring)
    // ----------------------------------------------------------------------------------

    @Test
    @DisplayName("A real SiteForecastService prediction is sent to ml-service, not left null")
    void realForecastIsSentToMlService() {
        when(siteForecast.forecast(SITE_ID, 30)).thenReturn(Optional.of(new SiteForecastService.SiteForecast(
                "wbgt", new BigDecimal("34.20"), 30, "wbgt-forecast-v1",
                new BigDecimal("33.00"), new BigDecimal("35.40"), NOW,
                com.crewsafe.forecast.service.ForecastBasis.MODEL, 5L, false)));
        stubDraft(validModelPlan(), false, MODEL_ID);

        service.generate(SITE_ID, SHIFT_ID, ACTOR_ID);

        assertThat(capturedRequest().forecastWbgt30m()).isEqualTo(34.2);
    }

    @Test
    @DisplayName("An unavailable forecast degrades to null rather than failing the draft (§7.1)")
    void unavailableForecastDegradesToNull() {
        when(siteForecast.forecast(SITE_ID, 30))
                .thenThrow(new ForecastUnavailableException("No recent weather exists for this site"));
        stubDraft(validModelPlan(), false, MODEL_ID);

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();

        assertThat(capturedRequest().forecastWbgt30m()).isNull();
        assertThat(saved.getStatus()).isEqualTo(Recommendation.RecommendationStatus.PENDING_APPROVAL);
    }

    // ----------------------------------------------------------------------------------
    // Request shaping
    // ----------------------------------------------------------------------------------

    @Test
    @DisplayName("The band is sent under its wire name, which is not the Java constant name")
    void bandIsSentUnderItsWireName() {
        stubDraft(validModelPlan(), false, MODEL_ID);

        service.generate(SITE_ID, SHIFT_ID, ACTOR_ID);

        // BAND_32_TO_BELOW_33.name() would be rejected by the ml-service contract: a Java
        // identifier cannot start with a digit, so the constants carry a prefix the wire drops.
        assertThat(capturedRequest().policyDecision().currentBand()).isEqualTo("32_TO_BELOW_33");
    }

    @Test
    @DisplayName("The policy decision is always attached, so ml-service can never draft without one")
    void policyDecisionIsAlwaysAttached() {
        stubDraft(validModelPlan(), false, MODEL_ID);

        service.generate(SITE_ID, SHIFT_ID, ACTOR_ID);

        AgentDraftClient.DraftRequest request = capturedRequest();
        assertThat(request.policyDecision()).isNotNull();
        assertThat(request.policyDecision().mandatoryActions()).hasSize(2);
    }

    @Test
    @DisplayName("A worker with no readiness submission is reported as such, not omitted")
    void missingReadinessIsReported() {
        stubDraft(validModelPlan(), false, MODEL_ID);

        service.generate(SITE_ID, SHIFT_ID, ACTOR_ID);

        assertThat(capturedRequest().workers()).singleElement()
                .satisfies(worker -> assertThat(worker.readinessSubmitted()).isFalse());
    }

    // ----------------------------------------------------------------------------------
    // Request-level rejections
    // ----------------------------------------------------------------------------------

    @Test
    @DisplayName("An unknown shift is empty, so the caller renders 404")
    void unknownShiftIsEmpty() {
        when(shifts.findByIdAndSiteId(SHIFT_ID, SITE_ID)).thenReturn(Optional.empty());

        assertThat(service.generate(SITE_ID, SHIFT_ID, ACTOR_ID)).isEmpty();
        verify(agentDraftClient, never()).draft(any());
    }

    @Test
    @DisplayName("A cancelled shift cannot be drafted for: its plan could be approved and fanned out")
    void cancelledShiftIsRejected() {
        when(shifts.findByIdAndSiteId(SHIFT_ID, SITE_ID)).thenReturn(Optional.of(shift(ShiftStatus.CANCELLED)));

        assertThatThrownBy(() -> service.generate(SITE_ID, SHIFT_ID, ACTOR_ID))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("CANCELLED");
    }

    @Test
    @DisplayName("A planned shift may be drafted for — the supervisor is preparing, not reacting")
    void plannedShiftIsAllowed() {
        when(shifts.findByIdAndSiteId(SHIFT_ID, SITE_ID)).thenReturn(Optional.of(shift(ShiftStatus.PLANNED)));
        stubDraft(validModelPlan(), false, MODEL_ID);

        assertThat(service.generate(SITE_ID, SHIFT_ID, ACTOR_ID)).isPresent();
    }

    @Test
    @DisplayName("No usable reading and no lightning is a 409, not an invented plan")
    void missingWeatherIsRejected() {
        when(weather.findLatestForSite(SITE_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.generate(SITE_ID, SHIFT_ID, ACTOR_ID))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("No usable WBGT reading")
                .extracting(e -> ((ConflictException) e).getCode())
                .isEqualTo(ErrorCode.NO_USABLE_WBGT);
        verify(agentDraftClient, never()).draft(any());
    }

    @Test
    @DisplayName("A sensor-fault reading is treated as no reading, not passed to the policy engine")
    void outOfRangeWbgtIsTreatedAsMissing() {
        // PolicyEngineService rejects anything outside 15-40°C by throwing, which would surface
        // as a 500 out of what is really a data-quality problem.
        when(weather.findLatestForSite(SITE_ID)).thenReturn(Optional.of(
                new WeatherQueryService.LatestSiteWeather(
                        observation(new BigDecimal("99.00")), WeatherQualityStatus.LIVE)));

        assertThatThrownBy(() -> service.generate(SITE_ID, SHIFT_ID, ACTOR_ID))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    @DisplayName("A site with no configured heat policy is a 409, not a 500")
    void missingPolicyVersionIsAConflictNotAServerError() {
        // Reachable, not theoretical: V9's seeding INSERT is commented out and V12 carried
        // forward from that empty table, so a site created through the API has no policy version
        // until a Safety Manager configures one. PolicyEngineService signals it with
        // NoSuchElementException, which no handler maps — so without this it reads as "the system
        // is broken" rather than "nobody has configured this site yet".
        when(policyEngine.evaluateForShift(any(), anyDouble(), anyList()))
                .thenThrow(new java.util.NoSuchElementException("No policy configured for site"));

        assertThatThrownBy(() -> service.generate(SITE_ID, SHIFT_ID, ACTOR_ID))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("No active heat policy")
                // The code is what makes this reach the supervisor as "ask a Safety Manager to
                // activate a policy version" instead of the generic 409's "reload and try again",
                // which is advice that cannot work — reloading never creates a policy version.
                .extracting(e -> ((ConflictException) e).getCode())
                .isEqualTo(ErrorCode.NO_ACTIVE_POLICY);
        verify(agentDraftClient, never()).draft(any());
    }

    @Test
    @DisplayName("A missing policy is refused rather than defaulted to built-in thresholds")
    void missingPolicyDoesNotFallBackToDefaults() {
        when(policyEngine.evaluateForShift(any(), anyDouble(), anyList()))
                .thenThrow(new java.util.NoSuchElementException("No policy configured for site"));

        assertThatThrownBy(() -> service.generate(SITE_ID, SHIFT_ID, ACTOR_ID))
                .isInstanceOf(ConflictException.class);
        // Nothing persisted: deciding what a worker must do from numbers nobody at this site
        // signed off on would be worse than refusing (§7.1 - thresholds are configuration).
        verify(recommendations, never()).save(any());
    }

    @Test
    @DisplayName("Lightning still produces a stop-work plan when there is no weather reading at all")
    void lightningWorksWithoutAnyWeatherReading() {
        when(weather.findLatestForSite(SITE_ID)).thenReturn(Optional.empty());
        when(lightning.deriveForSite(SITE_ID, NOW)).thenReturn(Optional.of(new LightningRiskPayload(
                LightningRiskState.STOP_WORK, new BigDecimal("2.00"), OBSERVED_AT, NOW,
                WeatherQualityStatus.STALE)));

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();

        assertThat(persistedCodes(saved)).containsExactly(PolicyActionCode.STOP_WORK);
        assertThat(evidenceOf(saved).observedWbgt()).isNull();
        assertThat(saved.getRationale()).contains("no WBGT reading was available");
    }

    // ----------------------------------------------------------------------------------
    // Audit
    // ----------------------------------------------------------------------------------

    @Test
    @DisplayName("Every draft is audited, and the detail names the model that wrote it")
    void draftIsAudited() {
        stubDraft(validModelPlan(), false, MODEL_ID);

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();
        commit();

        verify(audit).record(ACTOR_ID, AuditEventType.RECOMMENDATION_DRAFTED, "RECOMMENDATION",
                saved.getId(), "Recommendation drafted (model=" + MODEL_ID + ")");
    }

    @Test
    @DisplayName("A fallback draft is audited with why the model's output was not used")
    void fallbackDraftAuditRecordsTheReason() {
        stubDraft(List.of(mitigation("TAKE_A_NAP", "MANDATORY", "REST")), false, MODEL_ID);

        Recommendation saved = service.generate(SITE_ID, SHIFT_ID, ACTOR_ID).orElseThrow();
        commit();

        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(audit).record(any(), any(), any(), any(), detail.capture());
        assertThat(detail.getValue())
                .contains(AgentDraftService.FALLBACK_MODEL_VERSION)
                .contains("unknown_action_code");
    }

    @Test
    @DisplayName("The audit is deferred until commit, so a rolled-back draft leaves no event behind")
    void auditIsDeferredUntilCommit() {
        stubDraft(validModelPlan(), false, MODEL_ID);

        service.generate(SITE_ID, SHIFT_ID, ACTOR_ID);

        verify(audit, never()).record(any(), any(), any(), any(), any());
    }

    // ----------------------------------------------------------------------------------
    // Auto-trigger (SCRUM-291)
    // ----------------------------------------------------------------------------------

    @Test
    @DisplayName("generateAuto drafts with a null actor, recording that it was system-triggered")
    void generateAutoUsesANullActor() {
        when(recommendations.findFirstByShiftIdAndStatusOrderByCreatedAtDesc(
                SHIFT_ID, Recommendation.RecommendationStatus.PENDING_APPROVAL)).thenReturn(Optional.empty());
        stubDraft(validModelPlan(), false, MODEL_ID);

        Recommendation saved = service.generateAuto(SITE_ID, SHIFT_ID).orElseThrow();
        commit();

        assertThat(saved.getStatus()).isEqualTo(Recommendation.RecommendationStatus.PENDING_APPROVAL);
        verify(audit).record(isNull(), eq(AuditEventType.RECOMMENDATION_DRAFTED), eq("RECOMMENDATION"),
                eq(saved.getId()), any());
    }

    @Test
    @DisplayName("An open PENDING_APPROVAL recommendation is superseded before the new one is drafted")
    void generateAutoSupersedesAnOpenRecommendation() {
        Recommendation existing = Recommendation.builder()
                .id(UUID.randomUUID())
                .shiftId(SHIFT_ID)
                .status(Recommendation.RecommendationStatus.PENDING_APPROVAL)
                .createdAt(NOW.minusSeconds(600))
                .build();
        when(recommendations.findFirstByShiftIdAndStatusOrderByCreatedAtDesc(
                SHIFT_ID, Recommendation.RecommendationStatus.PENDING_APPROVAL)).thenReturn(Optional.of(existing));
        stubDraft(validModelPlan(), false, MODEL_ID);

        service.generateAuto(SITE_ID, SHIFT_ID);
        commit();

        assertThat(existing.getStatus()).isEqualTo(Recommendation.RecommendationStatus.SUPERSEDED);
        verify(recommendations).save(existing);
        verify(audit).record(isNull(), eq(AuditEventType.RECOMMENDATION_SUPERSEDED), eq("RECOMMENDATION"),
                eq(existing.getId()), any());
    }

    @Test
    @DisplayName("With no open recommendation for the shift, nothing is superseded")
    void generateAutoSupersedesNothingWhenNoneIsOpen() {
        when(recommendations.findFirstByShiftIdAndStatusOrderByCreatedAtDesc(
                SHIFT_ID, Recommendation.RecommendationStatus.PENDING_APPROVAL)).thenReturn(Optional.empty());
        stubDraft(validModelPlan(), false, MODEL_ID);

        service.generateAuto(SITE_ID, SHIFT_ID);
        commit();

        verify(audit, never()).record(any(), eq(AuditEventType.RECOMMENDATION_SUPERSEDED), any(), any(), any());
    }

    // ----------------------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------------------

    private void stubDraft(List<MitigationSuggestion> mitigations, boolean usedFallback, String modelId) {
        stubDraft(mitigations, usedFallback, modelId, 32.5);
    }

    private void stubDraft(List<MitigationSuggestion> mitigations, boolean usedFallback, String modelId,
                            Double forecast) {
        when(agentDraftClient.draft(any())).thenReturn(new AgentDraftClient.DraftResponse(
                "A model-written explanation of the plan.", mitigations, modelId, usedFallback,
                usedFallback ? "bedrock_unavailable" : null, forecast, "baseline-1.0.0", 900, 600));
    }

    private AgentDraftClient.DraftRequest capturedRequest() {
        ArgumentCaptor<AgentDraftClient.DraftRequest> captor =
                ArgumentCaptor.forClass(AgentDraftClient.DraftRequest.class);
        verify(agentDraftClient).draft(captor.capture());
        return captor.getValue();
    }

    private RecommendationEvidence evidenceOf(Recommendation recommendation) {
        try {
            return new ObjectMapper().findAndRegisterModules()
                    .readValue(recommendation.getEvidence(), RecommendationEvidence.class);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private List<MitigationSuggestion> parse(Recommendation recommendation) {
        try {
            return new ObjectMapper()
                    .readValue(recommendation.getDraftPlan(), MitigationSuggestion.Batch.class)
                    .mitigations();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private List<String> persistedCodes(Recommendation recommendation) {
        return parse(recommendation).stream().map(MitigationSuggestion::actionCode).toList();
    }

    private static List<MitigationSuggestion> validModelPlan() {
        return List.of(
                mitigation(PolicyActionCode.REST_15_MIN_HOURLY, "MANDATORY", "REST"),
                mitigation(PolicyActionCode.HYDRATE_HOURLY, "MANDATORY", "HYDRATION"),
                mitigation(PolicyActionCode.CLOSE_MONITORING, "ADVISORY", "MONITORING"));
    }

    private static MitigationSuggestion mitigation(String code, String origin, String category) {
        return new MitigationSuggestion("HIGH", "Do the thing", "Because it is hot",
                "Reduces heat stress", code, category, origin, "UNACCLIMATISED_HEAVY_WORK_RULE",
                List.of(WORKER_ID.toString()), null);
    }

    private static PolicyDecision policyDecision() {
        return new PolicyDecision("MOM-WBGT-2026.1", WbgtBand.BAND_32_TO_BELOW_33, WbgtBand.BAND_32_TO_BELOW_33,
                List.of(
                        action(PolicyActionCode.REST_15_MIN_HOURLY),
                        action(PolicyActionCode.HYDRATE_HOURLY)),
                List.of(action(PolicyActionCode.CLOSE_MONITORING)));
    }

    private static PolicyDecision.PolicyAction action(String code) {
        return new PolicyDecision.PolicyAction(code, "UNACCLIMATISED_HEAVY_WORK_RULE",
                List.of(WORKER_ID.toString()), "WBGT 32.5°C exceeds threshold 22.0°C");
    }

    private static Shift shift(ShiftStatus status) {
        Shift shift = new Shift(SITE_ID, NOW.minusSeconds(3600), NOW.plusSeconds(3600));
        ReflectionTestUtils.setField(shift, "id", SHIFT_ID);
        ReflectionTestUtils.setField(shift, "status", status);
        return shift;
    }

    /** {@link WeatherObservation} exposes only a protected no-arg constructor by design. */
    private static WeatherObservation observation(BigDecimal wbgt) {
        try {
            Constructor<WeatherObservation> constructor = WeatherObservation.class.getDeclaredConstructor();
            constructor.setAccessible(true);
            WeatherObservation observation = constructor.newInstance();
            ReflectionTestUtils.setField(observation, "siteId", SITE_ID);
            ReflectionTestUtils.setField(observation, "wbgt", wbgt);
            ReflectionTestUtils.setField(observation, "observedAt", OBSERVED_AT);
            ReflectionTestUtils.setField(observation, "source", WeatherSource.NEA);
            ReflectionTestUtils.setField(observation, "qualityStatus", WeatherQualityStatus.LIVE);
            ReflectionTestUtils.setField(observation, "stationId", "S50");
            return observation;
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }
}
