package com.crewsafe.wellbeing.config;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/** Cadence and connection lifetime for the US-11 open-concern SSE stream. */
@ConfigurationProperties(prefix = "app.wellbeing.stream")
@Validated
@Getter
@Setter
public class WellbeingStreamProperties {

    @NotNull
    private Duration pushInterval;

    @NotNull
    private Duration emitterTimeout;
}
