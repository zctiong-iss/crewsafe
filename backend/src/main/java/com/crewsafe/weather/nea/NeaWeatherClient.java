package com.crewsafe.weather.nea;

import java.util.List;

/**
 * Application-facing port for current NEA WBGT and weather observations.
 *
 * <p>The ingestion scheduler depends on this interface rather than data.gov.sg response
 * DTOs, keeping API-shape changes at the adapter boundary.
 */
public interface NeaWeatherClient {

    NeaObservation fetch(NeaMetric metric);

    default List<NeaObservation> fetchAll() {
        return List.of(
                fetch(NeaMetric.WBGT),
                fetch(NeaMetric.AIR_TEMPERATURE),
                fetch(NeaMetric.RELATIVE_HUMIDITY),
                fetch(NeaMetric.WIND_SPEED),
                fetch(NeaMetric.RAINFALL)
        );
    }
}
