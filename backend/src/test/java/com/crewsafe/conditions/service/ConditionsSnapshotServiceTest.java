package com.crewsafe.conditions.service;

import com.crewsafe.conditions.api.ActiveShiftPayload;
import com.crewsafe.conditions.api.ConditionsPayload;
import com.crewsafe.conditions.api.ConditionsSnapshot;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import com.crewsafe.weather.ingestion.WeatherFreshnessClassifier;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.lang.reflect.Constructor;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Covers freshness recomputation (stored status is never trusted as-is, except
 * {@code SIMULATED}) and that either half of the snapshot may legitimately be {@code null}.
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

    private ConditionsSnapshotService service;

    @BeforeEach
    void setUp() {
        service = new ConditionsSnapshotService(
                observations, shifts, freshnessClassifier, Clock.fixed(NOW, ZoneOffset.UTC));

        // Both sources default to "nothing found"; individual tests override only the one they exercise.
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID)).thenReturn(Optional.empty());
        when(shifts.findFirstBySiteIdAndStatusOrderByStartsAtDesc(SITE_ID, ShiftStatus.ACTIVE))
                .thenReturn(Optional.empty());
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
}
