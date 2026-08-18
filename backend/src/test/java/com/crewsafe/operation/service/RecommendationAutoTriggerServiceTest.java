package com.crewsafe.operation.service;

import com.crewsafe.lightning.api.LightningRiskPayload;
import com.crewsafe.lightning.domain.LightningRiskState;
import com.crewsafe.lightning.risk.LightningRiskDerivationService;
import com.crewsafe.operation.config.RecommendationAutoTriggerProperties;
import com.crewsafe.operation.domain.SiteConditionState;
import com.crewsafe.operation.repository.SiteConditionStateRepository;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WbgtBand;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import com.crewsafe.weather.service.WeatherQueryService;
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

import java.lang.reflect.Constructor;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link RecommendationAutoTriggerService} (SCRUM-291): detecting a WBGT band or lightning
 * risk-state transition, and triggering every eligible shift on it exactly once.
 *
 * @author Abu Bakar
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class RecommendationAutoTriggerServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-17T04:00:00Z");
    private static final Duration LEAD_WINDOW = Duration.ofMinutes(30);

    @Mock private SiteRepository sites;
    @Mock private ShiftRepository shifts;
    @Mock private WeatherQueryService weather;
    @Mock private LightningRiskDerivationService lightning;
    @Mock private SiteConditionStateRepository conditionStates;
    @Mock private AgentDraftService agentDraftService;

    private RecommendationAutoTriggerService service;
    private Site site;

    @BeforeEach
    void setUp() {
        RecommendationAutoTriggerProperties properties = new RecommendationAutoTriggerProperties();
        properties.setLeadWindow(LEAD_WINDOW);

        service = new RecommendationAutoTriggerService(sites, shifts, weather, lightning, conditionStates,
                agentDraftService, properties, Clock.fixed(NOW, ZoneOffset.UTC));

        site = new Site("Test Site", new BigDecimal("1.300000"), new BigDecimal("103.800000"));
        when(sites.findAll()).thenReturn(List.of(site));
        when(conditionStates.save(any())).thenAnswer(i -> i.getArgument(0));
        when(lightning.deriveForSite(any(), any())).thenReturn(Optional.empty());
        when(weather.findLatestForSite(any())).thenReturn(Optional.empty());
    }

    @Test
    @DisplayName("A site's first-ever evaluation seeds its state but triggers nothing")
    void firstEvaluationSeedsWithoutTriggering() {
        when(conditionStates.findById(site.getId())).thenReturn(Optional.empty());
        stubBand(new BigDecimal("32.50"));

        int triggeredCount = service.evaluateAllSites();

        assertThat(triggeredCount).isZero();
        verify(agentDraftService, never()).generateAuto(any(), any());

        ArgumentCaptor<SiteConditionState> saved = ArgumentCaptor.forClass(SiteConditionState.class);
        verify(conditionStates).save(saved.capture());
        assertThat(saved.getValue().getLastWbgtBand()).isEqualTo(WbgtBand.BAND_32_TO_BELOW_33);
        assertThat(saved.getValue().getLastEvaluatedAt()).isEqualTo(NOW);
    }

    @Test
    @DisplayName("No change in band or lightning state triggers nothing")
    void noTransitionTriggersNothing() {
        when(conditionStates.findById(site.getId())).thenReturn(Optional.of(
                new SiteConditionState(site.getId(), WbgtBand.BAND_32_TO_BELOW_33, LightningRiskState.CLEAR, NOW.minusSeconds(60))));
        stubBand(new BigDecimal("32.50"));
        stubLightning(LightningRiskState.CLEAR);

        int triggeredCount = service.evaluateAllSites();

        assertThat(triggeredCount).isZero();
        verify(agentDraftService, never()).generateAuto(any(), any());
    }

    @Test
    @DisplayName("A band transition triggers every eligible shift on the site")
    void bandTransitionTriggersEligibleShifts() {
        when(conditionStates.findById(site.getId())).thenReturn(Optional.of(
                new SiteConditionState(site.getId(), WbgtBand.BAND_31_TO_BELOW_32, LightningRiskState.CLEAR, NOW.minusSeconds(60))));
        stubBand(new BigDecimal("32.50"));
        stubLightning(LightningRiskState.CLEAR);

        UUID shiftAId = UUID.randomUUID();
        UUID shiftBId = UUID.randomUUID();
        when(shifts.findEligibleForAutoTrigger(site.getId(), NOW, NOW.plus(LEAD_WINDOW)))
                .thenReturn(List.of(shiftFor(shiftAId), shiftFor(shiftBId)));

        int triggeredCount = service.evaluateAllSites();

        assertThat(triggeredCount).isEqualTo(2);
        verify(agentDraftService).generateAuto(site.getId(), shiftAId);
        verify(agentDraftService).generateAuto(site.getId(), shiftBId);
    }

    @Test
    @DisplayName("A lightning-state-only transition triggers too, even with the band unchanged")
    void lightningTransitionTriggersEvenWithoutABandChange() {
        when(conditionStates.findById(site.getId())).thenReturn(Optional.of(
                new SiteConditionState(site.getId(), WbgtBand.BAND_31_TO_BELOW_32, LightningRiskState.CLEAR, NOW.minusSeconds(60))));
        stubBand(new BigDecimal("31.50"));
        stubLightning(LightningRiskState.STOP_WORK);

        UUID shiftId = UUID.randomUUID();
        when(shifts.findEligibleForAutoTrigger(any(), any(), any())).thenReturn(List.of(shiftFor(shiftId)));

        int triggeredCount = service.evaluateAllSites();

        assertThat(triggeredCount).isEqualTo(1);
        verify(agentDraftService).generateAuto(site.getId(), shiftId);
    }

    @Test
    @DisplayName("A band change alone while lightning stop-work is still in force triggers nothing")
    void bandChangeAloneDuringStopWorkTriggersNothing() {
        when(conditionStates.findById(site.getId())).thenReturn(Optional.of(
                new SiteConditionState(site.getId(), WbgtBand.BAND_31_TO_BELOW_32, LightningRiskState.STOP_WORK, NOW.minusSeconds(60))));
        stubBand(new BigDecimal("32.50"));
        stubLightning(LightningRiskState.STOP_WORK);

        int triggeredCount = service.evaluateAllSites();

        assertThat(triggeredCount).isZero();
        verify(agentDraftService, never()).generateAuto(any(), any());
    }

    @Test
    @DisplayName("Lightning clearing out of stop-work still triggers, even with the band unchanged")
    void lightningClearingStopWorkStillTriggers() {
        when(conditionStates.findById(site.getId())).thenReturn(Optional.of(
                new SiteConditionState(site.getId(), WbgtBand.BAND_31_TO_BELOW_32, LightningRiskState.STOP_WORK, NOW.minusSeconds(60))));
        stubBand(new BigDecimal("31.50"));
        stubLightning(LightningRiskState.CLEAR);

        UUID shiftId = UUID.randomUUID();
        when(shifts.findEligibleForAutoTrigger(any(), any(), any())).thenReturn(List.of(shiftFor(shiftId)));

        int triggeredCount = service.evaluateAllSites();

        assertThat(triggeredCount).isEqualTo(1);
        verify(agentDraftService).generateAuto(site.getId(), shiftId);
    }

    @Test
    @DisplayName("A sensor-fault reading is treated as no reading, not a real band")
    void sensorFaultReadingIsTreatedAsNoBand() {
        when(conditionStates.findById(site.getId())).thenReturn(Optional.of(
                new SiteConditionState(site.getId(), null, LightningRiskState.CLEAR, NOW.minusSeconds(60))));
        stubBand(new BigDecimal("99.00"));
        stubLightning(LightningRiskState.CLEAR);

        int triggeredCount = service.evaluateAllSites();

        assertThat(triggeredCount).isZero();
        ArgumentCaptor<SiteConditionState> saved = ArgumentCaptor.forClass(SiteConditionState.class);
        verify(conditionStates).save(saved.capture());
        assertThat(saved.getValue().getLastWbgtBand()).isNull();
    }

    @Test
    @DisplayName("One shift's draft failure does not stop the site's other eligible shifts")
    void oneShiftFailureDoesNotStopOthers() {
        when(conditionStates.findById(site.getId())).thenReturn(Optional.of(
                new SiteConditionState(site.getId(), WbgtBand.BAND_31_TO_BELOW_32, LightningRiskState.CLEAR, NOW.minusSeconds(60))));
        stubBand(new BigDecimal("32.50"));
        stubLightning(LightningRiskState.CLEAR);

        UUID failingShiftId = UUID.randomUUID();
        UUID okShiftId = UUID.randomUUID();
        when(shifts.findEligibleForAutoTrigger(any(), any(), any()))
                .thenReturn(List.of(shiftFor(failingShiftId), shiftFor(okShiftId)));
        when(agentDraftService.generateAuto(site.getId(), failingShiftId))
                .thenThrow(new IllegalStateException("no active policy configured"));

        int triggeredCount = service.evaluateAllSites();

        assertThat(triggeredCount).isEqualTo(1);
        verify(agentDraftService).generateAuto(site.getId(), okShiftId);
    }

    @Test
    @DisplayName("One site's evaluation failure does not stop the next site from being evaluated")
    void oneSiteFailureDoesNotStopTheNextSite() {
        Site otherSite = new Site("Other Site", new BigDecimal("1.300000"), new BigDecimal("103.800000"));
        when(sites.findAll()).thenReturn(List.of(site, otherSite));

        when(weather.findLatestForSite(site.getId())).thenThrow(new IllegalStateException("db unavailable"));

        when(conditionStates.findById(otherSite.getId())).thenReturn(Optional.of(
                new SiteConditionState(otherSite.getId(), WbgtBand.BAND_31_TO_BELOW_32, LightningRiskState.CLEAR, NOW.minusSeconds(60))));
        when(weather.findLatestForSite(otherSite.getId())).thenReturn(Optional.of(
                new WeatherQueryService.LatestSiteWeather(observation(new BigDecimal("32.50")), WeatherQualityStatus.LIVE)));
        when(lightning.deriveForSite(eq(otherSite.getId()), any())).thenReturn(Optional.of(
                new LightningRiskPayload(LightningRiskState.CLEAR, null, NOW, NOW, WeatherQualityStatus.LIVE)));
        UUID shiftId = UUID.randomUUID();
        when(shifts.findEligibleForAutoTrigger(eq(otherSite.getId()), any(), any())).thenReturn(List.of(shiftFor(shiftId)));

        int triggeredCount = service.evaluateAllSites();

        assertThat(triggeredCount).isEqualTo(1);
        verify(agentDraftService).generateAuto(otherSite.getId(), shiftId);
        // The failing site's state is never written -- it never got past the read that failed.
        verify(conditionStates, never()).save(argThatSiteIdIs(site.getId()));
    }

    @Test
    @DisplayName("The lead-window cutoff passed to the eligibility query is now + leadWindow")
    void leadWindowCutoffIsNowPlusLeadWindow() {
        when(conditionStates.findById(site.getId())).thenReturn(Optional.of(
                new SiteConditionState(site.getId(), WbgtBand.BAND_31_TO_BELOW_32, LightningRiskState.CLEAR, NOW.minusSeconds(60))));
        stubBand(new BigDecimal("32.50"));
        stubLightning(LightningRiskState.CLEAR);
        when(shifts.findEligibleForAutoTrigger(any(), any(), any())).thenReturn(List.of());

        service.evaluateAllSites();

        verify(shifts).findEligibleForAutoTrigger(site.getId(), NOW, NOW.plus(LEAD_WINDOW));
    }

    // ------------------------------------------------------------------------------------

    private void stubBand(BigDecimal wbgt) {
        when(weather.findLatestForSite(site.getId())).thenReturn(Optional.of(
                new WeatherQueryService.LatestSiteWeather(observation(wbgt), WeatherQualityStatus.LIVE)));
    }

    private void stubLightning(LightningRiskState state) {
        when(lightning.deriveForSite(eq(site.getId()), any())).thenReturn(Optional.of(
                new LightningRiskPayload(state, null, NOW, NOW, WeatherQualityStatus.LIVE)));
    }

    private static SiteConditionState argThatSiteIdIs(UUID siteId) {
        return org.mockito.ArgumentMatchers.argThat(state -> state != null && siteId.equals(state.getSiteId()));
    }

    private static Shift shiftFor(UUID id) {
        Shift shift = new Shift(UUID.randomUUID(), NOW.minusSeconds(3600), NOW.plusSeconds(3600));
        ReflectionTestUtils.setField(shift, "id", id);
        return shift;
    }

    /** {@link WeatherObservation} exposes only a protected no-arg constructor by design. */
    private static WeatherObservation observation(BigDecimal wbgt) {
        try {
            Constructor<WeatherObservation> constructor = WeatherObservation.class.getDeclaredConstructor();
            constructor.setAccessible(true);
            WeatherObservation observation = constructor.newInstance();
            ReflectionTestUtils.setField(observation, "wbgt", wbgt);
            ReflectionTestUtils.setField(observation, "observedAt", NOW);
            ReflectionTestUtils.setField(observation, "source", WeatherSource.NEA);
            ReflectionTestUtils.setField(observation, "qualityStatus", WeatherQualityStatus.LIVE);
            ReflectionTestUtils.setField(observation, "stationId", "S50");
            return observation;
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }
}
