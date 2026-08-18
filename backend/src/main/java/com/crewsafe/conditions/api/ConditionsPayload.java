package com.crewsafe.conditions.api;

import java.math.BigDecimal;
import java.time.Instant;

import com.crewsafe.weather.domain.WbgtBand;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource; 

/**
 * The weather half of a {@link ConditionsSnapshot}. {@code freshness} is recomputed on
 * every read, not trusted from storage.
 *
 * @author Jemilin Beulah
 */

public record ConditionsPayload(BigDecimal wbgt, WbgtBand currentBand, WbgtBand forecastBand,
                                BigDecimal forecastWbgt30m, BigDecimal temperature, BigDecimal humidity,
                                BigDecimal windSpeed, BigDecimal rainfall, Instant observedAt,
                                WeatherSource source, WeatherQualityStatus freshness) {
}