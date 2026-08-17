package com.crewsafe.lightning.ingestion;

import com.crewsafe.lightning.nea.NeaLightningClient;
import com.crewsafe.lightning.nea.NeaLightningObservation;
import com.crewsafe.lightning.nea.NeaLightningStrike;
import com.crewsafe.lightning.repository.LightningObservationRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
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
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** @author Jemilin Beulah */
@ExtendWith(MockitoExtension.class)
class LightningIngestionServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-30T09:00:00Z");
    private static final Instant OBSERVED_AT = Instant.parse("2026-07-30T08:58:00Z");
    private static final Instant STRUCK_AT = Instant.parse("2026-07-30T08:57:40Z");

    @Mock
    private NeaLightningClient client;

    @Mock
    private SiteRepository sites;

    @Mock
    private LightningObservationRepository observations;

    private LightningIngestionService service;

    @BeforeEach
    void setUp() {
        LightningIngestionProperties properties = new LightningIngestionProperties();
        properties.setDelayedAfter(Duration.ofMinutes(5));
        properties.setStaleAfter(Duration.ofMinutes(15));
        service = new LightningIngestionService(
                client, sites, observations, new NearestStrikeSelector(),
                new LightningFreshnessClassifier(properties), Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void insertsTheNearestStrikeAsOneLiveSiteReading() {
        Site site = new Site("Test Site", decimal("1.3000"), decimal("103.8000"));
        when(sites.findAll()).thenReturn(List.of(site));
        when(client.fetchLatest()).thenReturn(new NeaLightningObservation(OBSERVED_AT, List.of(
                new NeaLightningStrike(decimal("1.4300"), decimal("103.9600"), STRUCK_AT.minusSeconds(30), "C"),
                new NeaLightningStrike(decimal("1.3010"), decimal("103.8010"), STRUCK_AT, "G")
        )));
        when(observations.insertIfAbsent(any())).thenReturn(1);

        LightningIngestionResult result = service.ingestCurrentConditions();

        assertThat(result).isEqualTo(new LightningIngestionResult(1, 1, 0));
        verify(observations).insertIfAbsent(argThat(command ->
                command.siteId().equals(site.getId())
                        && command.nearestStrikeKm() != null
                        && command.nearestStrikeKm().doubleValue() < 2.0
                        && command.nearestStrikeKm().doubleValue() >= 0
                        && command.nearestStrikeAt().equals(STRUCK_AT)
                        && command.observedAt().equals(OBSERVED_AT)
                        && command.ingestedAt().equals(NOW)
                        && command.source().equals("NEA")
                        && command.qualityStatus().equals("LIVE")));
    }

    @Test
    void persistsANullDistanceWhenNoStrikesWereReportedThisTick() {
        Site site = new Site("Quiet Site", decimal("1.3000"), decimal("103.8000"));
        when(sites.findAll()).thenReturn(List.of(site));
        when(client.fetchLatest()).thenReturn(new NeaLightningObservation(OBSERVED_AT, List.of()));
        when(observations.insertIfAbsent(any())).thenReturn(1);

        service.ingestCurrentConditions();

        verify(observations).insertIfAbsent(argThat(command ->
                command.siteId().equals(site.getId())
                        && command.nearestStrikeKm() == null
                        && command.nearestStrikeAt() == null
                        && command.observedAt().equals(OBSERVED_AT)
                        && command.ingestedAt().equals(NOW)
                        && command.source().equals("NEA")
                        && command.qualityStatus().equals("LIVE")));
    }

    @Test
    void reportsDatabaseConflictAsDuplicateInsteadOfFailure() {
        Site site = new Site("Duplicate Site", decimal("1.3000"), decimal("103.8000"));
        when(sites.findAll()).thenReturn(List.of(site));
        when(client.fetchLatest()).thenReturn(new NeaLightningObservation(OBSERVED_AT, List.of()));
        when(observations.insertIfAbsent(any())).thenReturn(0);

        assertThat(service.ingestCurrentConditions())
                .isEqualTo(new LightningIngestionResult(1, 0, 1));
    }

    @Test
    void persistsFixtureReplayAsCachedAndSimulatedRegardlessOfItsAge() {
        Site site = new Site("Replay Site", decimal("1.3000"), decimal("103.8000"));
        when(sites.findAll()).thenReturn(List.of(site));
        when(client.fetchLatest()).thenReturn(new NeaLightningObservation(OBSERVED_AT, List.of(), true));
        when(observations.insertIfAbsent(any())).thenReturn(1);

        service.ingestCurrentConditions();

        verify(observations).insertIfAbsent(argThat(command ->
                command.siteId().equals(site.getId())
                        && command.nearestStrikeKm() == null
                        && command.nearestStrikeAt() == null
                        && command.observedAt().equals(OBSERVED_AT)
                        && command.ingestedAt().equals(NOW)
                        && command.source().equals("CACHED")
                        && command.qualityStatus().equals("SIMULATED")));
    }

    @Test
    void skipsExternalApiEntirelyWhenThereAreNoSites() {
        when(sites.findAll()).thenReturn(List.of());

        assertThat(service.ingestCurrentConditions()).isEqualTo(LightningIngestionResult.noSites());

        verifyNoInteractions(client, observations);
    }

    private BigDecimal decimal(String value) {
        return new BigDecimal(value);
    }
}
