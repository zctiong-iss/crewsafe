package com.crewsafe.weather.ingestion;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/** Scheduler cadence and freshness thresholds for site weather ingestion. */
@ConfigurationProperties(prefix = "app.weather.ingestion")
@Validated
@Getter
@Setter
public class WeatherIngestionProperties {

    private boolean enabled;

    @NotNull
    private Duration initialDelay;

    @NotNull
    private Duration interval;

    @NotNull
    private Duration delayedAfter;

    @NotNull
    private Duration staleAfter;

    @AssertTrue(message = "weather ingestion durations must be positive and stale-after must exceed delayed-after")
    public boolean isDurationConfigurationValid() {
        return initialDelay != null && !initialDelay.isNegative()
                && interval != null && !interval.isNegative() && !interval.isZero()
                && delayedAfter != null && !delayedAfter.isNegative() && !delayedAfter.isZero()
                && staleAfter != null && staleAfter.compareTo(delayedAfter) > 0;
    }
}
