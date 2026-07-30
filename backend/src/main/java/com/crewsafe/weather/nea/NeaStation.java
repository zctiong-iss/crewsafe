package com.crewsafe.weather.nea;

import java.math.BigDecimal;

/** A measurement station as identified and located by NEA. */
public record NeaStation(
        String id,
        String name,
        BigDecimal latitude,
        BigDecimal longitude
) {
}
