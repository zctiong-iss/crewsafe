package com.crewsafe.weather.service;

import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/** Read-only weather queries used by the CrewSafe API. */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class WeatherQueryService {

    private final WeatherObservationRepository observations;

    /** Returns the newest stored conditions for a site, if ingestion has produced any. */
    public Optional<WeatherObservation> findLatestForSite(UUID siteId) {
        return observations.findFirstBySiteIdOrderByObservedAtDesc(siteId);
    }
}
