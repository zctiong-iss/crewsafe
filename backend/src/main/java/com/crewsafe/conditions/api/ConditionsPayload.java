package com.crewsafe.conditions.api;

import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;

import java.math.BigDecimal;
import java.time.Instant;

/** The weather half of a {@link ConditionsSnapshot}. {@code freshness} is recomputed on every read, not trusted from storage. */
public record ConditionsPayload(BigDecimal wbgt, BigDecimal temperature, BigDecimal humidity,
                                 BigDecimal windSpeed, BigDecimal rainfall, Instant observedAt,
                                 WeatherSource source, WeatherQualityStatus freshness) {
}
