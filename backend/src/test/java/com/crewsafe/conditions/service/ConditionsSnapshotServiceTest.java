package com.crewsafe.conditions.service;

import java.lang.reflect.Constructor;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import org.mockito.Mock;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.crewsafe.conditions.api.ActiveShiftPayload;
import com.crewsafe.conditions.api.ConditionsPayload;
import com.crewsafe.conditions.api.ConditionsSnapshot;
import com.crewsafe.forecast.service.ForecastUnavailableException;
import com.crewsafe.forecast.service.SiteForecastService;
import com.crewsafe.lightning.api.LightningRiskPayload;
import com.crewsafe.lightning.domain.LightningRiskState;
import com.crewsafe.lightning.risk.LightningRiskDerivationService;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.weather.domain.WbgtBand;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import com.crewsafe.weather.ingestion.WeatherFreshnessClassifier;
import com.crewsafe.weather.repository.WeatherObservationRepository;

/**
 * Covers freshness recomputation (stored status is never trusted as-is, except
 * {@code SIMULATED}) and that either half of the snapshot may legitimately be {@code null}.
 *
 * @author Jemilin Beulah
 */
@ExtendWith(MockitoExtension.class)
class ConditionsSnapshotServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-30T09:00:00Z");
    private static final Instant OBSERVED_AT = Instant.parse("2026-07-30T08:15:00Z");
    private static final UUID SITE_ID = UUID.randomUUID();

    @Mock
    private WeatherObservationRepository observations;

    @Mock
    private ShiftRepository shifts;

    @Mock
    private WeatherFreshnessClassifier freshnessClassifier;

    @Mock
    private LightningRiskDerivationService lightningRiskDerivationService;

    @Mock
    private SiteForecastService siteForecastService;

    private ConditionsSnapshotService service;

    @BeforeEach
    void setUp() {
    service = new ConditionsSnapshotService(observations, shifts, freshnessClassifier,
            lightningRiskDerivationService, siteForecastService,          // ← inserted before Clock
            Clock.fixed(NOW, ZoneOffset.UTC));

        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID)).thenReturn(Optional.empty());
        when(shifts.findFirstBySiteIdAndStatusOrderByStartsAtDesc(SITE_ID, ShiftStatus.ACTIVE))
            .thenReturn(Optional.empty());
        when(lightningRiskDerivationService.deriveForSite(eq(SITE_ID), any(Instant.class)))
            .thenReturn(Optional.empty());
        // lenient: getSnapshot always calls forecast, but the guard test overrides this with a
        // throw, which would otherwise trip strict-stubs on this setUp stub.
        lenient().when(siteForecastService.forecast(eq(SITE_ID), anyInt())).thenReturn(Optional.empty());
        }

    @Test
    void conditionsIsNullWhenNoObservationHasEverBeenIngested() {
        ConditionsSnapshot snapshot = service.getSnapshot(SITE_ID);

        assertThat(snapshot.conditions()).isNull();
        assertThat(snapshot.siteId()).isEqualTo(SITE_ID);
        assertThat(snapshot.asOf()).isEqualTo(NOW);
        verifyNoInteractions(freshnessClassifier);
    }

    @Test
    void recomputesFreshnessInsteadOfTrustingTheStoredStatus() {
        // Stored as LIVE at ingest time, but the classifier — evaluated against "now" — says
        // it has since gone STALE. The payload must reflect the recomputed value.
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID))
                .thenReturn(Optional.of(observation(WeatherQualityStatus.LIVE)));
        when(freshnessClassifier.classify(OBSERVED_AT, NOW)).thenReturn(WeatherQualityStatus.STALE);

        ConditionsPayload conditions = service.getSnapshot(SITE_ID).conditions();

        assertThat(conditions.freshness()).isEqualTo(WeatherQualityStatus.STALE);
        assertThat(conditions.wbgt()).isEqualByComparingTo("31.20");
        assertThat(conditions.observedAt()).isEqualTo(OBSERVED_AT);
        assertThat(conditions.source()).isEqualTo(WeatherSource.NEA);
        verify(freshnessClassifier).classify(OBSERVED_AT, NOW);
    }

    @Test
    void preservesSimulatedRegardlessOfAge() {
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID))
                .thenReturn(Optional.of(observation(WeatherQualityStatus.SIMULATED)));

        ConditionsPayload conditions = service.getSnapshot(SITE_ID).conditions();

        assertThat(conditions.freshness()).isEqualTo(WeatherQualityStatus.SIMULATED);
        verifyNoInteractions(freshnessClassifier);
    }

    @Test
    void lightningIsNullWhenIngestionHasNeverRun() {
        ConditionsSnapshot snapshot = service.getSnapshot(SITE_ID);

        assertThat(snapshot.lightning()).isNull();
    }

    @Test
    void mapsTheDerivedLightningStateWhenPresent() {
        LightningRiskPayload derived = new LightningRiskPayload(LightningRiskState.STOP_WORK,
                new BigDecimal("6.40"), OBSERVED_AT, OBSERVED_AT.plusSeconds(1_800), WeatherQualityStatus.LIVE);
        when(lightningRiskDerivationService.deriveForSite(SITE_ID, NOW)).thenReturn(Optional.of(derived));

        assertThat(service.getSnapshot(SITE_ID).lightning()).isEqualTo(derived);
    }

    @Test
    void activeShiftIsNullWhenNoneIsActive() {
        ConditionsSnapshot snapshot = service.getSnapshot(SITE_ID);

        assertThat(snapshot.activeShift()).isNull();
    }

    @Test
    void mapsTheActiveShiftWhenOneIsPresent() {
        Shift shift = new Shift(SITE_ID, Instant.parse("2026-07-30T08:00:00Z"),
                Instant.parse("2026-07-30T16:00:00Z"));
        when(shifts.findFirstBySiteIdAndStatusOrderByStartsAtDesc(SITE_ID, ShiftStatus.ACTIVE))
                .thenReturn(Optional.of(shift));

        ActiveShiftPayload activeShift = service.getSnapshot(SITE_ID).activeShift();

        assertThat(activeShift.shiftId()).isEqualTo(shift.getId());
        assertThat(activeShift.startsAt()).isEqualTo(shift.getStartsAt());
        assertThat(activeShift.endsAt()).isEqualTo(shift.getEndsAt());
    }

    @Test
    void classifiesCurrentBandAndLeavesForecastBandNullWithoutAForecast() {
    WeatherObservation observation = observationWithWbgt(new BigDecimal("32.5"));  // reuse your fixture helper
    when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID))
            .thenReturn(Optional.of(observation));
    when(freshnessClassifier.classify(any(Instant.class), any(Instant.class)))
            .thenReturn(WeatherQualityStatus.LIVE);
    // siteForecastService default from setUp = Optional.empty()

    ConditionsPayload payload = service.getSnapshot(SITE_ID).conditions();

    assertThat(payload.currentBand()).isEqualTo(WbgtBand.BAND_32_TO_BELOW_33);
    assertThat(payload.forecastBand()).isNull();
}

    @Test
    void keepsTheSnapshotWhenTheForecastDependencyIsUnavailable() {
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID))
                .thenReturn(Optional.of(observationWithWbgt(new BigDecimal("32.5"))));
        when(freshnessClassifier.classify(any(Instant.class), any(Instant.class)))
                .thenReturn(WeatherQualityStatus.LIVE);
        when(siteForecastService.forecast(eq(SITE_ID), anyInt()))
                .thenThrow(new ForecastUnavailableException("no usable reading"));

        ConditionsPayload payload = service.getSnapshot(SITE_ID).conditions();

        assertThat(payload).isNotNull();                                        // forecast outage != fatal
        assertThat(payload.currentBand()).isEqualTo(WbgtBand.BAND_32_TO_BELOW_33);
        assertThat(payload.forecastBand()).isNull();
        assertThat(payload.forecastWbgt30m()).isNull();
    }

    /**
     * {@link WeatherObservation} only exposes a protected no-arg constructor by design, so
     * reflection is the only way to build one here for a mocked return value.
     */
    private static WeatherObservation observation(WeatherQualityStatus qualityStatus) {
        try {
            Constructor<WeatherObservation> constructor = WeatherObservation.class.getDeclaredConstructor();
            constructor.setAccessible(true);
            WeatherObservation observation = constructor.newInstance();
            ReflectionTestUtils.setField(observation, "siteId", SITE_ID);
            ReflectionTestUtils.setField(observation, "wbgt", new BigDecimal("31.20"));
            ReflectionTestUtils.setField(observation, "temperature", new BigDecimal("29.10"));
            ReflectionTestUtils.setField(observation, "humidity", new BigDecimal("81.00"));
            ReflectionTestUtils.setField(observation, "windSpeed", new BigDecimal("4.00"));
            ReflectionTestUtils.setField(observation, "rainfall", BigDecimal.ZERO);
            ReflectionTestUtils.setField(observation, "observedAt", OBSERVED_AT);
            ReflectionTestUtils.setField(observation, "source", WeatherSource.NEA);
            ReflectionTestUtils.setField(observation, "qualityStatus", qualityStatus);
            return observation;
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static WeatherObservation observationWithWbgt(BigDecimal wbgt) {
        WeatherObservation observation = observation(WeatherQualityStatus.LIVE);
        ReflectionTestUtils.setField(observation, "wbgt", wbgt);
        return observation;
    }
}
