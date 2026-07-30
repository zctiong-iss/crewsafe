package com.crewsafe.weather.ingestion;

/** Counts produced by one scheduler run for logs, metrics, and tests. */
public record WeatherIngestionResult(int sitesProcessed, int inserted, int duplicates) {

    public static WeatherIngestionResult noSites() {
        return new WeatherIngestionResult(0, 0, 0);
    }
}
