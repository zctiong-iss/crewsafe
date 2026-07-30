package com.crewsafe.weather.domain;

/** Freshness or simulation state persisted with a weather observation. */
public enum WeatherQualityStatus {
    LIVE,
    DELAYED,
    STALE,
    SIMULATED
}
