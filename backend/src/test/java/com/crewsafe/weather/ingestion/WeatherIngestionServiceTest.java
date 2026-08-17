package com.crewsafe.weather.ingestion;

import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.nea.NeaMetric;
import com.crewsafe.weather.nea.NeaObservation;
import com.crewsafe.weather.nea.NeaStation;
import com.crewsafe.weather.nea.NeaStationReading;
import com.crewsafe.weather.nea.NeaWeatherClient;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WeatherIngestionServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-30T09:00:00Z");
    private static final Instant OBSERVED_AT = Instant.parse("2026-07-30T08:30:00Z");

    @Mock
    private NeaWeatherClient client;

    @Mock
    private SiteRepository sites;

    @Mock
    private WeatherObservationRepository observations;

    private WeatherIngestionService service;

    @BeforeEach
    void setUp() {
        WeatherIngestionProperties properties = new WeatherIngestionProperties();
        properties.setDelayedAfter(Duration.ofMinutes(20));
        properties.setStaleAfter(Duration.ofMinutes(45));
        service = new WeatherIngestionService(
                client,
                sites,
                observations,
                new NearestStationSelector(),
                new WeatherFreshnessClassifier(properties),
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void insertsNearestReadingsAsOneDelayedSiteSnapshot() {
        Site site = new Site("Test Site", decimal("1.3000"), decimal("103.8000"));
        when(sites.findAll()).thenReturn(List.of(site));
        when(client.fetchAll()).thenReturn(completeSnapshot());
        when(observations.insertIfAbsent(any())).thenReturn(1);

        WeatherIngestionResult result = service.ingestCurrentConditions();

        assertThat(result).isEqualTo(new WeatherIngestionResult(1, 1, 0));
        verify(observations).insertIfAbsent(argThat(command ->
                command.siteId().equals(site.getId())
                        && command.wbgt().equals(decimal("31.2"))
                        && command.temperature().equals(decimal("29.1"))
                        && command.humidity().equals(decimal("81.0"))
                        && command.windSpeed().equals(decimal("4.0"))
                        && command.rainfall().equals(decimal("0.0"))
                        && command.observedAt().equals(OBSERVED_AT)
                        && command.ingestedAt().equals(NOW)
                        && command.source().equals("NEA")
                        && command.qualityStatus().equals("DELAYED")
                        && command.stationId().equals("WBGT-NEAR")));
    }

    @Test
    void reportsDatabaseConflictAsDuplicateInsteadOfFailure() {
        Site site = new Site("Duplicate Site", decimal("1.3000"), decimal("103.8000"));
        when(sites.findAll()).thenReturn(List.of(site));
        when(client.fetchAll()).thenReturn(completeSnapshot());
        when(observations.insertIfAbsent(any())).thenReturn(0);

        assertThat(service.ingestCurrentConditions())
                .isEqualTo(new WeatherIngestionResult(1, 0, 1));
    }

    @Test
    void persistsFixtureReplayAsCachedAndSimulatedRegardlessOfItsAge() {
        Site site = new Site("Replay Site", decimal("1.3000"), decimal("103.8000"));
        when(sites.findAll()).thenReturn(List.of(site));
        when(client.fetchAll()).thenReturn(completeSnapshot().stream()
                .map(observation -> new NeaObservation(
                        observation.metric(), observation.observedAt(), observation.unit(),
                        observation.readings(), true))
                .toList());
        when(observations.insertIfAbsent(any())).thenReturn(1);

        assertThat(service.ingestCurrentConditions())
                .isEqualTo(new WeatherIngestionResult(1, 1, 0));
        verify(observations).insertIfAbsent(argThat(command ->
                command.siteId().equals(site.getId())
                        && command.wbgt().equals(decimal("31.2"))
                        && command.temperature().equals(decimal("29.1"))
                        && command.humidity().equals(decimal("81.0"))
                        && command.windSpeed().equals(decimal("4.0"))
                        && command.rainfall().equals(decimal("0.0"))
                        && command.observedAt().equals(OBSERVED_AT)
                        && command.ingestedAt().equals(NOW)
                        && command.source().equals("CACHED")
                        && command.qualityStatus().equals("SIMULATED")
                        && command.stationId().equals("WBGT-NEAR")));
    }

    @Test
    void refusesToMixLiveAndSimulatedMetrics() {
        Site site = new Site("Mixed Mode Site", decimal("1.3000"), decimal("103.8000"));
        when(sites.findAll()).thenReturn(List.of(site));
        List<NeaObservation> mixed = completeSnapshot().stream()
                .map(observation -> observation.metric() == NeaMetric.RAINFALL
                        ? new NeaObservation(observation.metric(), observation.observedAt(),
                                observation.unit(), observation.readings(), true)
                        : observation)
                .toList();
        when(client.fetchAll()).thenReturn(mixed);

        assertThatThrownBy(service::ingestCurrentConditions)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("mixed live and simulated");
        verify(observations, never()).insertIfAbsent(any());
    }

    @Test
    void skipsExternalApiEntirelyWhenThereAreNoSites() {
        when(sites.findAll()).thenReturn(List.of());

        assertThat(service.ingestCurrentConditions()).isEqualTo(WeatherIngestionResult.noSites());

        verifyNoInteractions(client, observations);
    }

    @Test
    void refusesToPersistAPartialApiSnapshot() {
        Site site = new Site("Partial Site", decimal("1.3000"), decimal("103.8000"));
        when(sites.findAll()).thenReturn(List.of(site));
        when(client.fetchAll()).thenReturn(completeSnapshot().stream()
                .filter(observation -> observation.metric() != NeaMetric.RAINFALL)
                .toList());

        assertThatThrownBy(service::ingestCurrentConditions)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("RAINFALL");
        verify(observations, never()).insertIfAbsent(any());
    }

    private List<NeaObservation> completeSnapshot() {
        return Arrays.stream(NeaMetric.values())
                .map(metric -> observation(metric, value(metric)))
                .toList();
    }

    private NeaObservation observation(NeaMetric metric, BigDecimal nearValue) {
        String prefix = metric == NeaMetric.WBGT ? "WBGT" : metric.name();
        return new NeaObservation(metric, OBSERVED_AT, "unit", List.of(
                reading(prefix + "-FAR", "1.4300", "103.9600", decimal("999.0")),
                reading(prefix + "-NEAR", "1.3010", "103.8010", nearValue)
        ));
    }

    private BigDecimal value(NeaMetric metric) {
        return switch (metric) {
            case WBGT -> decimal("31.2");
            case AIR_TEMPERATURE -> decimal("29.1");
            case RELATIVE_HUMIDITY -> decimal("81.0");
            case WIND_SPEED -> decimal("4.0");
            case RAINFALL -> decimal("0.0");
        };
    }

    private NeaStationReading reading(String id, String latitude, String longitude,
                                      BigDecimal value) {
        return new NeaStationReading(
                new NeaStation(id, id + " station", decimal(latitude), decimal(longitude)),
                value, null);
    }

    private BigDecimal decimal(String value) {
        return new BigDecimal(value);
    }
}
