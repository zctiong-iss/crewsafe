package com.crewsafe.forecast.service;

import com.crewsafe.forecast.client.ForecastApiClient;
import com.crewsafe.forecast.client.ForecastApiClient.ForecastApiRequest;
import com.crewsafe.forecast.client.ForecastApiClient.ForecastApiResponse;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The forecast ladder.
 *
 * <p>The behaviour under test is mostly the <em>absence</em> of refusals. The previous version of
 * this service threw on seven distinct paths, and against real NEA delivery it took almost all of
 * them almost always — so these tests are largely about conditions that used to produce nothing
 * now producing a labelled, appropriately-uncertain answer instead.
 *
 * @author Justin Chua
 */
class SiteForecastServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-14T04:00:00Z");
    /** On the 15-minute grid, five minutes old: comfortably a clean MODEL context. */
    private static final Instant LATEST = Instant.parse("2026-08-14T03:55:00Z");

    private SiteRepository sites;
    private WeatherObservationRepository weather;
    private ForecastApiClient client;
    private SiteForecastService service;
    private UUID siteId;

    @BeforeEach
    void setUp() {
        sites = mock(SiteRepository.class);
        weather = mock(WeatherObservationRepository.class);
        client = mock(ForecastApiClient.class);
        service = new SiteForecastService(sites, weather, client, Clock.fixed(NOW, ZoneOffset.UTC));
        siteId = UUID.randomUUID();
        when(sites.findById(siteId)).thenReturn(Optional.of(
                new Site("Test Site", new BigDecimal("1.300000"), new BigDecimal("103.800000"))));
    }

    // ── Tier 1: the model on clean context ──────────────────────────────────────────────────

    @Test
    @DisplayName("Clean on-cadence context reaches the model and is not marked degraded")
    void cleanContextUsesTheModel() {
        givenReadings(gridReadings(9));
        when(client.forecast(any())).thenReturn(apiResponse());

        SiteForecastService.SiteForecast result = service.forecast(siteId, 30).orElseThrow();

        ArgumentCaptor<ForecastApiRequest> request = ArgumentCaptor.forClass(ForecastApiRequest.class);
        verify(client).forecast(request.capture());
        assertThat(request.getValue().context().observations())
                .extracting(ForecastApiClient.ForecastObservation::observedAt)
                .isSorted();
        assertThat(result.basis()).isEqualTo(ForecastBasis.MODEL);
        assertThat(result.degraded()).isFalse();
        assertThat(result.modelVersion()).isEqualTo("wbgt-v2:hist-gradient");
    }

    /** The good path must be numerically untouched, or the ladder has regressed what worked. */
    @Test
    @DisplayName("A clean model result keeps the model's own confidence interval")
    void cleanModelResultKeepsItsNativeInterval() {
        givenReadings(gridReadings(9));
        when(client.forecast(any())).thenReturn(apiResponse());

        SiteForecastService.SiteForecast result = service.forecast(siteId, 30).orElseThrow();

        assertThat(result.confidenceIntervalLower()).isEqualByComparingTo("30.8");
        assertThat(result.confidenceIntervalUpper()).isEqualByComparingTo("32.8");
    }

    @Test
    @DisplayName("Timestamps off the grid are snapped rather than rejected")
    void jitteredTimestampsAreSnappedOntoTheGrid() {
        List<WeatherObservation> readings = gridReadings(9);
        // 40 seconds late: the old exact-cadence check compared Durations with equals and threw.
        when(readings.get(3).getObservedAt()).thenReturn(LATEST.minusSeconds(45L * 60L - 40L));
        givenReadings(readings);
        when(client.forecast(any())).thenReturn(apiResponse());

        SiteForecastService.SiteForecast result = service.forecast(siteId, 30).orElseThrow();

        assertThat(result.basis()).isEqualTo(ForecastBasis.MODEL);
        verify(client).forecast(any());
    }

    // ── Tier 2: the model on repaired context ───────────────────────────────────────────────

    /**
     * The regression that motivated the ladder. One missing reading used to disqualify a window
     * two hours wide, so a single dropped ingestion cycle removed forecasting for two hours.
     */
    @Test
    @DisplayName("A single missing reading is interpolated and still reaches the model")
    void oneMissingSlotIsImputedAndStillUsesTheModel() {
        List<WeatherObservation> readings = new ArrayList<>(gridReadings(9));
        readings.remove(3);
        givenReadings(readings);
        when(client.forecast(any())).thenReturn(apiResponse());

        SiteForecastService.SiteForecast result = service.forecast(siteId, 30).orElseThrow();

        assertThat(result.basis()).isEqualTo(ForecastBasis.MODEL_IMPUTED);
        assertThat(result.degraded()).isTrue();
        verify(client).forecast(any());
    }

    @Test
    @DisplayName("An imputed context widens the interval beyond the model's own")
    void imputedContextWidensTheInterval() {
        List<WeatherObservation> readings = new ArrayList<>(gridReadings(9));
        readings.remove(3);
        givenReadings(readings);
        when(client.forecast(any())).thenReturn(apiResponse());

        SiteForecastService.SiteForecast result = service.forecast(siteId, 30).orElseThrow();

        BigDecimal halfWidth = result.confidenceIntervalUpper()
                .subtract(result.confidenceIntervalLower())
                .divide(BigDecimal.valueOf(2), 2, java.math.RoundingMode.HALF_UP);
        assertThat(halfWidth).isGreaterThan(new BigDecimal("1.00"));
    }

    @Test
    @DisplayName("Too many holes abandons the model rather than predicting from guesses")
    void tooManyMissingSlotsFallsBelowTheModelTier() {
        List<WeatherObservation> readings = new ArrayList<>(gridReadings(9));
        readings.remove(5);
        readings.remove(3);
        readings.remove(1);
        givenReadings(readings);

        SiteForecastService.SiteForecast result = service.forecast(siteId, 30).orElseThrow();

        assertThat(result.basis()).isEqualTo(ForecastBasis.TREND);
        verify(client, never()).forecast(any());
    }

    // ── Tier 3: trend ───────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("Two readings and no model context still produce a forecast")
    void twoReadingsProduceATrendForecast() {
        givenReadings(List.of(
                observation(LATEST, new BigDecimal("31.4")),
                observation(LATEST.minusSeconds(30L * 60L), new BigDecimal("30.4"))));

        SiteForecastService.SiteForecast result = service.forecast(siteId, 30).orElseThrow();

        assertThat(result.basis()).isEqualTo(ForecastBasis.TREND);
        assertThat(result.degraded()).isTrue();
        // Rising readings project upward, but damping keeps it near the observations rather
        // than extrapolating the raw slope.
        assertThat(result.predictedValue()).isGreaterThan(new BigDecimal("31.4"));
        assertThat(result.predictedValue()).isLessThan(new BigDecimal("33.0"));
    }

    @Test
    @DisplayName("A trend is clipped to the plausible band, never extrapolated out of it")
    void trendCannotLeaveThePlausibleBand() {
        // A realistic rise that happens to start near the top of the band. Unclamped this
        // projects past 40, which is not a temperature the rest of the system accepts.
        givenReadings(List.of(
                observation(LATEST, new BigDecimal("39.80")),
                observation(LATEST.minusSeconds(30L * 60L), new BigDecimal("39.00"))));

        SiteForecastService.SiteForecast result = service.forecast(siteId, 30).orElseThrow();

        assertThat(result.predictedValue()).isLessThanOrEqualTo(new BigDecimal("40"));
    }

    /**
     * A slope that steep is a sensor glitch rather than weather, and a range wide enough to
     * cover it carries no information. Refusing beats publishing "somewhere between two
     * different answers".
     */
    @Test
    @DisplayName("A wild slope exceeds the usefulness ceiling and is refused")
    void animplausiblySteepTrendIsRefusedRatherThanPublished() {
        givenReadings(List.of(
                observation(LATEST, new BigDecimal("39.5")),
                observation(LATEST.minusSeconds(15L * 60L), new BigDecimal("30.0"))));

        assertThatThrownBy(() -> service.forecast(siteId, 30))
                .isInstanceOf(ForecastUnavailableException.class);
    }

    @Test
    @DisplayName("An unreachable ml-service degrades to a trend instead of failing")
    void modelFailureFallsThroughToTrend() {
        givenReadings(gridReadings(9));
        when(client.forecast(any())).thenThrow(new RuntimeException("connection refused"));

        SiteForecastService.SiteForecast result = service.forecast(siteId, 30).orElseThrow();

        assertThat(result.basis()).isEqualTo(ForecastBasis.TREND);
    }

    // ── Tier 4: persistence ─────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("A single reading still produces a forecast, carried forward and labelled")
    void oneReadingProducesAPersistenceForecast() {
        givenReadings(List.of(observation(LATEST, new BigDecimal("31.4"))));

        SiteForecastService.SiteForecast result = service.forecast(siteId, 30).orElseThrow();

        assertThat(result.basis()).isEqualTo(ForecastBasis.PERSISTENCE);
        assertThat(result.predictedValue()).isEqualByComparingTo("31.4");
        assertThat(result.degraded()).isTrue();
    }

    /**
     * A stale reading is exactly the case the old service refused. It now answers, and the
     * widening is what stops that answer from looking as trustworthy as a fresh one.
     */
    @Test
    @DisplayName("An old reading still forecasts, with a wider interval than a fresh one")
    void staleInputWidensTheIntervalRatherThanRefusing() {
        givenReadings(List.of(observation(NOW.minusSeconds(100L * 60L), new BigDecimal("31.4"))));
        SiteForecastService.SiteForecast stale = service.forecast(siteId, 30).orElseThrow();

        givenReadings(List.of(observation(LATEST, new BigDecimal("31.4"))));
        SiteForecastService.SiteForecast fresh = service.forecast(siteId, 30).orElseThrow();

        assertThat(halfWidth(stale)).isGreaterThan(halfWidth(fresh));
        assertThat(stale.inputAgeMinutes()).isGreaterThan(fresh.inputAgeMinutes());
    }

    // ── The remaining silences ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("Nothing at all is still no forecast — the one honest silence")
    void noReadingsIsStillUnavailable() {
        givenReadings(List.of());

        assertThatThrownBy(() -> service.forecast(siteId, 30))
                .isInstanceOf(ForecastUnavailableException.class);
    }

    @Test
    @DisplayName("A reading past the ceiling is too old to forecast from")
    void aReadingBeyondTheCeilingIsUnavailable() {
        givenReadings(List.of(observation(NOW.minusSeconds(200L * 60L), new BigDecimal("31.4"))));

        assertThatThrownBy(() -> service.forecast(siteId, 30))
                .isInstanceOf(ForecastUnavailableException.class);
    }

    @Test
    @DisplayName("Simulated demo data never reaches a forecast a supervisor might act on")
    void simulatedReadingsAreExcluded() {
        WeatherObservation simulated = observation(LATEST, new BigDecimal("31.4"));
        when(simulated.getQualityStatus()).thenReturn(WeatherQualityStatus.SIMULATED);
        givenReadings(List.of(simulated));

        assertThatThrownBy(() -> service.forecast(siteId, 30))
                .isInstanceOf(ForecastUnavailableException.class);
        verify(client, never()).forecast(any());
    }

    @Test
    @DisplayName("A sensor-fault reading is treated as no reading")
    void outOfBandReadingsAreExcluded() {
        givenReadings(List.of(observation(LATEST, new BigDecimal("99.0"))));

        assertThatThrownBy(() -> service.forecast(siteId, 30))
                .isInstanceOf(ForecastUnavailableException.class);
    }

    @Test
    void returnsEmptyForAnUnknownSite() {
        when(sites.findById(siteId)).thenReturn(Optional.empty());

        assertThat(service.forecast(siteId, 30)).isEmpty();
        verify(weather, never()).findTop24BySiteIdOrderByObservedAtDesc(siteId);
    }

    @Test
    void rejectsUnsupportedHorizonsBeforeCallingDependencies() {
        assertThatThrownBy(() -> service.forecast(siteId, 45))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("horizonMinutes must be 30 or 60");
    }

    // ── Fixtures ────────────────────────────────────────────────────────────────────────────

    private void givenReadings(List<WeatherObservation> readings) {
        when(weather.findTop24BySiteIdOrderByObservedAtDesc(siteId)).thenReturn(readings);
    }

    private static BigDecimal halfWidth(SiteForecastService.SiteForecast forecast) {
        return forecast.confidenceIntervalUpper()
                .subtract(forecast.confidenceIntervalLower())
                .divide(BigDecimal.valueOf(2), 2, java.math.RoundingMode.HALF_UP);
    }

    /** Newest first, on an exact 15-minute grid, gently rising so a trend has a slope to find. */
    private List<WeatherObservation> gridReadings(int count) {
        List<WeatherObservation> readings = new ArrayList<>();
        for (int index = 0; index < count; index++) {
            readings.add(observation(
                    LATEST.minusSeconds(index * 15L * 60L),
                    new BigDecimal("31.4").subtract(BigDecimal.valueOf(index * 0.1))));
        }
        return readings;
    }

    private WeatherObservation observation(Instant observedAt, BigDecimal wbgt) {
        WeatherObservation observation = mock(WeatherObservation.class);
        when(observation.getObservedAt()).thenReturn(observedAt);
        when(observation.getWbgt()).thenReturn(wbgt);
        when(observation.getStationId()).thenReturn("S-test");
        when(observation.getQualityStatus()).thenReturn(WeatherQualityStatus.LIVE);
        return observation;
    }

    private ForecastApiResponse apiResponse() {
        return new ForecastApiResponse(
                "wbgt",
                new BigDecimal("31.8"),
                30,
                "wbgt-v2:hist-gradient",
                new BigDecimal("30.8"),
                new BigDecimal("32.8"),
                NOW);
    }
}
