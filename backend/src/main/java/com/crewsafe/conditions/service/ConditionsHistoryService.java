package com.crewsafe.conditions.service;

import com.crewsafe.conditions.api.ConditionsHistoryResponse;
import com.crewsafe.conditions.api.ConditionsHistoryResponse.ConditionsHistoryPoint;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Reads the fixed rolling window used by the conditions-screen WBGT chart. */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ConditionsHistoryService {

    private static final Duration HISTORY_WINDOW = Duration.ofHours(4);

    private final WeatherObservationRepository observations;
    private final Clock clock;

    public ConditionsHistoryResponse getHistory(UUID siteId) {
        Instant asOf = clock.instant();
        Instant from = asOf.minus(HISTORY_WINDOW);
        List<ConditionsHistoryPoint> points = observations.findWbgtHistory(siteId, from, asOf)
                .stream()
                .map(observation -> new ConditionsHistoryPoint(
                        observation.getObservedAt(), observation.getWbgt()))
                .toList();

        return new ConditionsHistoryResponse(from, asOf, points);
    }
}
