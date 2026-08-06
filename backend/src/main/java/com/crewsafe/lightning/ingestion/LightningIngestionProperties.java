package com.crewsafe.lightning.ingestion;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/**
 * Scheduler cadence and freshness thresholds for site lightning ingestion. A separate
 * cadence from {@code WeatherIngestionProperties}: NEA refreshes lightning roughly every two
 * minutes, far more often than WBGT's fifteen, because a stop-work decision cannot wait on
 * the heat-data poll interval.
 *
 * @author Jemilin Beulah
 */
@ConfigurationProperties(prefix = "app.lightning.ingestion")
@Validated
@Getter
@Setter
public class LightningIngestionProperties {

    private boolean enabled;

    @NotNull
    private Duration initialDelay;

    @NotNull
    private Duration interval;

    @NotNull
    private Duration delayedAfter;

    @NotNull
    private Duration staleAfter;

    @AssertTrue(message = "lightning ingestion durations must be positive and stale-after must exceed delayed-after")
    public boolean isDurationConfigurationValid() {
        return initialDelay != null && !initialDelay.isNegative()
                && interval != null && !interval.isNegative() && !interval.isZero()
                && delayedAfter != null && !delayedAfter.isNegative() && !delayedAfter.isZero()
                && staleAfter != null && staleAfter.compareTo(delayedAfter) > 0;
    }
}
