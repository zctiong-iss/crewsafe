package com.crewsafe.weather.ingestion;

import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import com.crewsafe.weather.nea.NeaMetric;
import com.crewsafe.weather.nea.NeaObservation;
import com.crewsafe.weather.nea.NeaStationReading;
import com.crewsafe.weather.nea.NeaWeatherClient;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Fetches one live NEA snapshot and safely persists the nearest readings for every site. */
@Service
@RequiredArgsConstructor
public class WeatherIngestionService {

    private final NeaWeatherClient neaWeatherClient;
    private final SiteRepository siteRepository;
    private final WeatherObservationRepository observationRepository;
    private final NearestStationSelector nearestStationSelector;
    private final WeatherFreshnessClassifier freshnessClassifier;
    private final Clock clock;

    @Transactional
    public WeatherIngestionResult ingestCurrentConditions() {
        List<Site> sites = siteRepository.findAll();
        if (sites.isEmpty()) {
            return WeatherIngestionResult.noSites();
        }

        Map<NeaMetric, NeaObservation> observations = requireCompleteSnapshot(
                neaWeatherClient.fetchAll());
        NeaObservation wbgtObservation = observations.get(NeaMetric.WBGT);
        Instant ingestedAt = clock.instant();
        boolean simulated = requireConsistentMode(observations);
        WeatherQualityStatus qualityStatus = simulated
                ? WeatherQualityStatus.SIMULATED
                : freshnessClassifier.classify(wbgtObservation.observedAt(), ingestedAt);
        WeatherSource source = simulated ? WeatherSource.CACHED : WeatherSource.NEA;

        int inserted = 0;
        for (Site site : sites) {
            inserted += persistSiteSnapshot(site, observations, wbgtObservation,
                    ingestedAt, qualityStatus, source);
        }
        return new WeatherIngestionResult(sites.size(), inserted, sites.size() - inserted);
    }

    private int persistSiteSnapshot(Site site, Map<NeaMetric, NeaObservation> observations,
                                    NeaObservation wbgtObservation, Instant ingestedAt,
                                    WeatherQualityStatus qualityStatus, WeatherSource source) {
        NeaStationReading wbgt = nearest(site, observations, NeaMetric.WBGT);
        NeaStationReading temperature = nearest(site, observations, NeaMetric.AIR_TEMPERATURE);
        NeaStationReading humidity = nearest(site, observations, NeaMetric.RELATIVE_HUMIDITY);
        NeaStationReading windSpeed = nearest(site, observations, NeaMetric.WIND_SPEED);
        NeaStationReading rainfall = nearest(site, observations, NeaMetric.RAINFALL);

        // observed_at and station_id deliberately anchor the combined row to WBGT, the
        // primary safety signal. Supporting metrics can come from different nearest
        // stations and slightly different timestamps in NEA's independent feeds.
        return observationRepository.insertIfAbsent(
                UUID.randomUUID(),
                site.getId(),
                wbgt.value(),
                temperature.value(),
                humidity.value(),
                windSpeed.value(),
                rainfall.value(),
                wbgtObservation.observedAt(),
                ingestedAt,
                source.name(),
                qualityStatus.name(),
                wbgt.station().id());
    }

    private NeaStationReading nearest(Site site, Map<NeaMetric, NeaObservation> observations,
                                      NeaMetric metric) {
        return nearestStationSelector.select(site, observations.get(metric).readings());
    }

    private Map<NeaMetric, NeaObservation> requireCompleteSnapshot(List<NeaObservation> fetched) {
        if (fetched == null) {
            throw new IllegalStateException("NEA client returned no observation list");
        }

        Map<NeaMetric, NeaObservation> byMetric = new EnumMap<>(NeaMetric.class);
        for (NeaObservation observation : fetched) {
            if (observation == null || observation.metric() == null) {
                throw new IllegalStateException("NEA client returned an observation without a metric");
            }
            if (byMetric.put(observation.metric(), observation) != null) {
                throw new IllegalStateException("NEA client returned duplicate metric "
                        + observation.metric());
            }
        }

        for (NeaMetric metric : NeaMetric.values()) {
            if (!byMetric.containsKey(metric)) {
                throw new IllegalStateException("NEA client did not return required metric " + metric);
            }
        }
        return byMetric;
    }

    private boolean requireConsistentMode(Map<NeaMetric, NeaObservation> observations) {
        boolean simulated = observations.get(NeaMetric.WBGT).simulated();
        if (observations.values().stream()
                .anyMatch(observation -> observation.simulated() != simulated)) {
            throw new IllegalStateException("NEA client mixed live and simulated observations");
        }
        return simulated;
    }
}
