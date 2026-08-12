package com.crewsafe.observability.health;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/** Configuration for the bounded, process-local NEA readiness observation. */
@ConfigurationProperties(prefix = "app.nea.health")
@Validated
@Getter
@Setter
public class NeaHealthProperties {

    @NotNull
    private Duration observationInterval = Duration.ofSeconds(30);

    @NotNull
    private Duration maximumObservationAge = Duration.ofSeconds(60);

    @NotNull
    private Duration observationTimeout = Duration.ofSeconds(4);

    @Min(1)
    private int maxAttempts = 1;

    @AssertTrue(message = "NEA health timings must be positive, interval must be shorter than maximum age, and timeout must be below five seconds")
    public boolean isTimingConfigurationValid() {
        return isPositive(observationInterval)
                && isPositive(maximumObservationAge)
                && isPositive(observationTimeout)
                && observationInterval.compareTo(maximumObservationAge) < 0
                && observationTimeout.compareTo(Duration.ofSeconds(5)) < 0;
    }

    private boolean isPositive(Duration value) {
        return value != null && !value.isZero() && !value.isNegative();
    }
}
