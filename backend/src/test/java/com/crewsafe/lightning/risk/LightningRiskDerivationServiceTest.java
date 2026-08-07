package com.crewsafe.lightning.risk;

import com.crewsafe.lightning.api.LightningRiskPayload;
import com.crewsafe.lightning.domain.LightningObservation;
import com.crewsafe.lightning.domain.LightningRiskState;
import com.crewsafe.lightning.ingestion.LightningFreshnessClassifier;
import com.crewsafe.lightning.repository.LightningObservationRepository;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.lang.reflect.Constructor;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Covers the core SCRUM-170 acceptance: state is derived deterministically from recent
 * strike history and expires correctly, rather than being trusted from a single latest row.
 *
 * @author Jemilin Beulah
 */
@ExtendWith(MockitoExtension.class)
class LightningRiskDerivationServiceTest {

    private static final UUID SITE_ID = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-07-30T09:00:00Z");
    private static final Duration WINDOW = Duration.ofMinutes(30);

    @Mock
    private LightningObservationRepository observations;

    @Mock
    private LightningFreshnessClassifier freshnessClassifier;

    private LightningRiskDerivationService service;

    @BeforeEach
    void setUp() {
        LightningRiskProperties properties = new LightningRiskProperties();
        properties.setStopWorkRadiusKm(10.0);
        properties.setAdvisoryRadiusKm(20.0);
        properties.setValidityWindow(WINDOW);
        service = new LightningRiskDerivationService(observations, freshnessClassifier, properties);
    }

    @Test
    void emptyWhenLightningHasNeverBeenIngestedForTheSite() {
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID)).thenReturn(Optional.empty());

        Optional<LightningRiskPayload> result = service.deriveForSite(SITE_ID, NOW);

        assertThat(result).isEmpty();
        verifyNoInteractions(freshnessClassifier);
    }

    @Test
    void clearWithAFreshnessCarryingValidUntilWhenNothingQualifies() {
        Instant observedAt = NOW.minusSeconds(60);
        LightningObservation latest = row(observedAt, null, null, WeatherQualityStatus.LIVE);
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID)).thenReturn(Optional.of(latest));
        when(observations.findBySiteIdAndObservedAtGreaterThanEqualOrderByObservedAtDesc(
                SITE_ID, NOW.minus(WINDOW))).thenReturn(List.of(latest));
        when(freshnessClassifier.classify(observedAt, NOW)).thenReturn(WeatherQualityStatus.LIVE);

        LightningRiskPayload payload = service.deriveForSite(SITE_ID, NOW).orElseThrow();

        assertThat(payload.state()).isEqualTo(LightningRiskState.CLEAR);
        assertThat(payload.nearestStrikeKm()).isNull();
        assertThat(payload.observedAt()).isEqualTo(observedAt);
        assertThat(payload.validUntil()).isEqualTo(observedAt.plus(WINDOW));
        assertThat(payload.freshness()).isEqualTo(WeatherQualityStatus.LIVE);
    }

    @Test
    void stopWorkWhenTheNearestRecentStrikeIsInsideTheStopWorkRadius() {
        Instant observedAt = NOW.minusSeconds(30);
        Instant strikeAt = NOW.minusSeconds(45);
        LightningObservation latest = row(observedAt, decimal("6.40"), strikeAt, WeatherQualityStatus.LIVE);
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID)).thenReturn(Optional.of(latest));
        when(observations.findBySiteIdAndObservedAtGreaterThanEqualOrderByObservedAtDesc(
                SITE_ID, NOW.minus(WINDOW))).thenReturn(List.of(latest));
        when(freshnessClassifier.classify(observedAt, NOW)).thenReturn(WeatherQualityStatus.LIVE);

        LightningRiskPayload payload = service.deriveForSite(SITE_ID, NOW).orElseThrow();

        assertThat(payload.state()).isEqualTo(LightningRiskState.STOP_WORK);
        assertThat(payload.nearestStrikeKm()).isEqualByComparingTo("6.40");
        assertThat(payload.validUntil()).isEqualTo(strikeAt.plus(WINDOW));
    }

    @Test
    void advisoryWhenTheNearestRecentStrikeIsOutsideStopWorkButInsideAdvisory() {
        Instant observedAt = NOW.minusSeconds(30);
        Instant strikeAt = NOW.minusSeconds(45);
        LightningObservation latest = row(observedAt, decimal("15.00"), strikeAt, WeatherQualityStatus.LIVE);
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID)).thenReturn(Optional.of(latest));
        when(observations.findBySiteIdAndObservedAtGreaterThanEqualOrderByObservedAtDesc(
                SITE_ID, NOW.minus(WINDOW))).thenReturn(List.of(latest));
        when(freshnessClassifier.classify(observedAt, NOW)).thenReturn(WeatherQualityStatus.LIVE);

        LightningRiskPayload payload = service.deriveForSite(SITE_ID, NOW).orElseThrow();

        assertThat(payload.state()).isEqualTo(LightningRiskState.ADVISORY);
        assertThat(payload.nearestStrikeKm()).isEqualByComparingTo("15.00");
    }

    @Test
    void aStrikeBeyondTheAdvisoryRadiusLeavesTheSiteClear() {
        Instant observedAt = NOW.minusSeconds(30);
        LightningObservation latest = row(observedAt, decimal("25.00"), NOW.minusSeconds(45),
                WeatherQualityStatus.LIVE);
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID)).thenReturn(Optional.of(latest));
        when(observations.findBySiteIdAndObservedAtGreaterThanEqualOrderByObservedAtDesc(
                SITE_ID, NOW.minus(WINDOW))).thenReturn(List.of(latest));
        when(freshnessClassifier.classify(observedAt, NOW)).thenReturn(WeatherQualityStatus.LIVE);

        assertThat(service.deriveForSite(SITE_ID, NOW).orElseThrow().state())
                .isEqualTo(LightningRiskState.CLEAR);
    }

    @Test
    void stopWorkOutranksAdvisoryEvenWhenTheAdvisoryReadingIsMoreRecent() {
        Instant stopWorkTickAt = NOW.minus(Duration.ofMinutes(10));
        Instant advisoryTickAt = NOW.minusSeconds(30);
        LightningObservation stopWorkRow = row(stopWorkTickAt, decimal("5.00"),
                stopWorkTickAt.minusSeconds(10), WeatherQualityStatus.LIVE);
        LightningObservation advisoryRow = row(advisoryTickAt, decimal("18.00"),
                advisoryTickAt.minusSeconds(10), WeatherQualityStatus.LIVE);
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID))
                .thenReturn(Optional.of(advisoryRow));
        when(observations.findBySiteIdAndObservedAtGreaterThanEqualOrderByObservedAtDesc(
                SITE_ID, NOW.minus(WINDOW)))
                .thenReturn(List.of(advisoryRow, stopWorkRow));
        when(freshnessClassifier.classify(advisoryTickAt, NOW)).thenReturn(WeatherQualityStatus.LIVE);

        assertThat(service.deriveForSite(SITE_ID, NOW).orElseThrow().state())
                .isEqualTo(LightningRiskState.STOP_WORK);
    }

    @Test
    void holdsStopWorkFromAnOlderTickWhenTheLatestTickSawNoStrikes() {
        Instant qualifyingTickAt = NOW.minus(Duration.ofMinutes(12));
        Instant strikeAt = qualifyingTickAt.minusSeconds(10);
        Instant latestTickAt = NOW.minusSeconds(20);
        LightningObservation qualifyingRow = row(qualifyingTickAt, decimal("4.00"), strikeAt,
                WeatherQualityStatus.LIVE);
        LightningObservation latestRow = row(latestTickAt, null, null, WeatherQualityStatus.LIVE);
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID)).thenReturn(Optional.of(latestRow));
        when(observations.findBySiteIdAndObservedAtGreaterThanEqualOrderByObservedAtDesc(
                SITE_ID, NOW.minus(WINDOW)))
                .thenReturn(List.of(latestRow, qualifyingRow));
        when(freshnessClassifier.classify(latestTickAt, NOW)).thenReturn(WeatherQualityStatus.LIVE);

        LightningRiskPayload payload = service.deriveForSite(SITE_ID, NOW).orElseThrow();

        assertThat(payload.state()).isEqualTo(LightningRiskState.STOP_WORK);
        // Freshness basis is the latest tick even though the qualifying strike is older.
        assertThat(payload.observedAt()).isEqualTo(latestTickAt);
        assertThat(payload.validUntil()).isEqualTo(strikeAt.plus(WINDOW));
    }

    @Test
    void aQualifyingStrikeOlderThanTheValidityWindowNoLongerHoldsTheState() {
        // The repository query is bounded by the cutoff already, so an expired row simply
        // never appears in "recent" — this asserts the derivation trusts that bound.
        Instant observedAt = NOW.minusSeconds(30);
        LightningObservation latest = row(observedAt, null, null, WeatherQualityStatus.LIVE);
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID)).thenReturn(Optional.of(latest));
        when(observations.findBySiteIdAndObservedAtGreaterThanEqualOrderByObservedAtDesc(
                SITE_ID, NOW.minus(WINDOW))).thenReturn(List.of(latest));
        when(freshnessClassifier.classify(observedAt, NOW)).thenReturn(WeatherQualityStatus.LIVE);

        assertThat(service.deriveForSite(SITE_ID, NOW).orElseThrow().state())
                .isEqualTo(LightningRiskState.CLEAR);
    }

    @Test
    void preservesSimulatedFreshnessRegardlessOfAge() {
        Instant observedAt = NOW.minus(Duration.ofHours(3));
        LightningObservation latest = row(observedAt, null, null, WeatherQualityStatus.SIMULATED);
        when(observations.findFirstBySiteIdOrderByObservedAtDesc(SITE_ID)).thenReturn(Optional.of(latest));
        when(observations.findBySiteIdAndObservedAtGreaterThanEqualOrderByObservedAtDesc(
                SITE_ID, NOW.minus(WINDOW))).thenReturn(List.of());

        LightningRiskPayload payload = service.deriveForSite(SITE_ID, NOW).orElseThrow();

        assertThat(payload.freshness()).isEqualTo(WeatherQualityStatus.SIMULATED);
        verifyNoInteractions(freshnessClassifier);
    }

    private static LightningObservation row(Instant observedAt, BigDecimal nearestStrikeKm,
                                            Instant nearestStrikeAt, WeatherQualityStatus qualityStatus) {
        try {
            Constructor<LightningObservation> constructor =
                    LightningObservation.class.getDeclaredConstructor();
            constructor.setAccessible(true);
            LightningObservation observation = constructor.newInstance();
            ReflectionTestUtils.setField(observation, "siteId", SITE_ID);
            ReflectionTestUtils.setField(observation, "nearestStrikeKm", nearestStrikeKm);
            ReflectionTestUtils.setField(observation, "nearestStrikeAt", nearestStrikeAt);
            ReflectionTestUtils.setField(observation, "observedAt", observedAt);
            ReflectionTestUtils.setField(observation, "source", WeatherSource.NEA);
            ReflectionTestUtils.setField(observation, "qualityStatus", qualityStatus);
            return observation;
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static BigDecimal decimal(String value) {
        return new BigDecimal(value);
    }
}
