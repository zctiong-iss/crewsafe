package com.crewsafe.weather.nea;

import java.time.Instant;
import java.util.List;

/** A timestamped set of readings for one environmental measurement. */
public record NeaObservation(
        NeaMetric metric,
        Instant observedAt,
        String unit,
        List<NeaStationReading> readings,
        boolean simulated
) {

    public NeaObservation {
        readings = List.copyOf(readings);
    }

    public NeaObservation(NeaMetric metric, Instant observedAt, String unit,
                          List<NeaStationReading> readings) {
        this(metric, observedAt, unit, readings, false);
    }
}
