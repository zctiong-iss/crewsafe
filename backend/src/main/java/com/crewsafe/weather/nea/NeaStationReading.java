package com.crewsafe.weather.nea;

import java.math.BigDecimal;

/** One station's value in an observation batch. */
public record NeaStationReading(
        NeaStation station,
        BigDecimal value,
        String heatStress
) {
}
