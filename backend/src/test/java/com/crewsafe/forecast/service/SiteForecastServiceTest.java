package com.crewsafe.forecast.service;

import com.crewsafe.forecast.client.ForecastApiClient;
import com.crewsafe.forecast.client.ForecastApiClient.ForecastApiRequest;
import com.crewsafe.forecast.client.ForecastApiClient.ForecastApiResponse;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.ingestion.WeatherFreshnessClassifier;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.Clock;
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

class SiteForecastServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-14T04:00:00Z");

    private SiteRepository sites;
    private WeatherObservationRepository weather;
    private ForecastApiClient client;
    private WeatherFreshnessClassifier freshnessClassifier;
    private SiteForecastService service;
    private UUID siteId;

    @BeforeEach
    void setUp() {
        sites = mock(SiteRepository.class);
        weather = mock(WeatherObservationRepository.class);
        client = mock(ForecastApiClient.class);
        freshnessClassifier = mock(WeatherFreshnessClassifier.class);
        service = new SiteForecastService(
                sites,
                weather,
                client,
                freshnessClassifier,
                Clock.fixed(NOW, ZoneOffset.UTC));
        siteId = UUID.randomUUID();
        when(sites.findById(siteId)).thenReturn(Optional.of(
                new Site("Test Site", new BigDecimal("1.300000"),
                        new BigDecimal("103.800000"))));
        when(freshnessClassifier.classify(any(), any())).thenReturn(WeatherQualityStatus.LIVE);
    }

    @Test
    void sendsNineStoredReadingsFromOldestToNewest() {
        List<WeatherObservation> readings = newestFirstReadings();
        when(weather.findTop9BySiteIdOrderByObservedAtDesc(siteId))
                .thenReturn(readings);
        when(client.forecast(any())).thenReturn(apiResponse());

        SiteForecastService.SiteForecast result = service.forecast(siteId, 30).orElseThrow();

        ArgumentCaptor<ForecastApiRequest> request = ArgumentCaptor.forClass(ForecastApiRequest.class);
        verify(client).forecast(request.capture());
        assertThat(request.getValue().context().observations())
                .extracting(ForecastApiClient.ForecastObservation::observedAt)
                .isSorted();
        assertThat(request.getValue().context().observations()).hasSize(9);
        assertThat(request.getValue().currentValue()).isEqualByComparingTo("31.4");
        assertThat(result.modelVersion()).isEqualTo("wbgt-v2:hist-gradient");
    }

    @Test
    void rejectsSimulatedContextBeforeCallingTheModel() {
        List<WeatherObservation> readings = newestFirstReadings();
        when(readings.getFirst().getQualityStatus()).thenReturn(WeatherQualityStatus.SIMULATED);
        when(weather.findTop9BySiteIdOrderByObservedAtDesc(siteId)).thenReturn(readings);

        assertThatThrownBy(() -> service.forecast(siteId, 30))
                .isInstanceOf(ForecastUnavailableException.class);

        verify(client, never()).forecast(any());
    }

    @Test
    void rejectsAnOlderSimulatedReadingBeforeCallingTheModel() {
        List<WeatherObservation> readings = newestFirstReadings();
        when(readings.get(4).getQualityStatus()).thenReturn(WeatherQualityStatus.SIMULATED);
        when(weather.findTop9BySiteIdOrderByObservedAtDesc(siteId)).thenReturn(readings);

        assertThatThrownBy(() -> service.forecast(siteId, 30))
                .isInstanceOf(ForecastUnavailableException.class);

        verify(client, never()).forecast(any());
    }

    @Test
    void recomputesAndRejectsContextThatHasBecomeStale() {
        List<WeatherObservation> readings = newestFirstReadings();
        when(weather.findTop9BySiteIdOrderByObservedAtDesc(siteId)).thenReturn(readings);
        when(freshnessClassifier.classify(any(), any())).thenReturn(WeatherQualityStatus.STALE);

        assertThatThrownBy(() -> service.forecast(siteId, 30))
                .isInstanceOf(ForecastUnavailableException.class);

        verify(client, never()).forecast(any());
    }

    @Test
    void rejectsIrregularTimestampsBeforeCallingTheModel() {
        List<WeatherObservation> readings = newestFirstReadings();
        when(readings.get(1).getObservedAt()).thenReturn(NOW.minusSeconds(20 * 60L));
        when(weather.findTop9BySiteIdOrderByObservedAtDesc(siteId)).thenReturn(readings);

        assertThatThrownBy(() -> service.forecast(siteId, 30))
                .isInstanceOf(ForecastUnavailableException.class);

        verify(client, never()).forecast(any());
    }

    @Test
    void returnsEmptyForAnUnknownSite() {
        when(sites.findById(siteId)).thenReturn(Optional.empty());

        assertThat(service.forecast(siteId, 30)).isEmpty();
        verify(weather, never()).findTop9BySiteIdOrderByObservedAtDesc(siteId);
    }

    @Test
    void rejectsUnsupportedHorizonsBeforeCallingDependencies() {
        assertThatThrownBy(() -> service.forecast(siteId, 45))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("horizonMinutes must be 30 or 60");
    }

    private List<WeatherObservation> newestFirstReadings() {
        List<WeatherObservation> readings = new ArrayList<>();
        for (int index = 0; index < 9; index++) {
            readings.add(observation(
                    NOW.minusSeconds(index * 15L * 60L),
                    new BigDecimal("31.4")));
        }
        return readings;
    }

    private WeatherObservation observation(Instant observedAt, BigDecimal wbgt) {
        WeatherObservation observation = mock(WeatherObservation.class);
        when(observation.getObservedAt()).thenReturn(observedAt);
        when(observation.getWbgt()).thenReturn(wbgt);
        when(observation.getTemperature()).thenReturn(new BigDecimal("32.2"));
        when(observation.getHumidity()).thenReturn(new BigDecimal("70.0"));
        when(observation.getWindSpeed()).thenReturn(new BigDecimal("2.5"));
        when(observation.getRainfall()).thenReturn(BigDecimal.ZERO);
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
