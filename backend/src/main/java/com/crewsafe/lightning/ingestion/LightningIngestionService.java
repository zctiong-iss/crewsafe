package com.crewsafe.lightning.ingestion;

import com.crewsafe.lightning.nea.NeaLightningClient;
import com.crewsafe.lightning.nea.NeaLightningObservation;
import com.crewsafe.lightning.repository.LightningObservationRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Fetches one live lightning batch and safely persists the nearest-strike reading for every
 * site — one row per site per tick, even when no strike was reported, so the derivation
 * service can tell "polled, nothing nearby" from "never polled".
 *
 * @author Jemilin Beulah
 */
@Service
@RequiredArgsConstructor
public class LightningIngestionService {

    private final NeaLightningClient neaLightningClient;
    private final SiteRepository siteRepository;
    private final LightningObservationRepository observationRepository;
    private final NearestStrikeSelector nearestStrikeSelector;
    private final LightningFreshnessClassifier freshnessClassifier;
    private final Clock clock;

    @Transactional
    public LightningIngestionResult ingestCurrentConditions() {
        List<Site> sites = siteRepository.findAll();
        if (sites.isEmpty()) {
            return LightningIngestionResult.noSites();
        }

        NeaLightningObservation batch = neaLightningClient.fetchLatest();
        if (batch == null) {
            throw new IllegalStateException("NEA lightning client returned no observation");
        }
        Instant ingestedAt = clock.instant();
        WeatherQualityStatus qualityStatus = batch.simulated()
                ? WeatherQualityStatus.SIMULATED
                : freshnessClassifier.classify(batch.observedAt(), ingestedAt);
        WeatherSource source = batch.simulated() ? WeatherSource.CACHED : WeatherSource.NEA;

        int inserted = 0;
        for (Site site : sites) {
            inserted += persistSiteReading(site, batch, ingestedAt, qualityStatus, source);
        }
        return new LightningIngestionResult(sites.size(), inserted, sites.size() - inserted);
    }

    private int persistSiteReading(Site site, NeaLightningObservation batch, Instant ingestedAt,
                                   WeatherQualityStatus qualityStatus, WeatherSource source) {
        Optional<NearestStrikeSelector.Selection> nearest =
                nearestStrikeSelector.select(site, batch.strikes());

        return observationRepository.insertIfAbsent(new LightningObservationRepository.InsertObservationCommand(
                UUID.randomUUID(),
                site.getId(),
                nearest.map(NearestStrikeSelector.Selection::distanceKm).orElse(null),
                nearest.map(selection -> selection.strike().struckAt()).orElse(null),
                batch.observedAt(),
                ingestedAt,
                source.name(),
                qualityStatus.name()));
    }
}
