package com.crewsafe.conditions.config;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/** Cadence and connection lifetime for the site conditions SSE stream (SCRUM-168). */
@ConfigurationProperties(prefix = "app.conditions.stream")
@Validated
@Getter
@Setter
public class ConditionsStreamProperties {

    @NotNull
    private Duration pushInterval;

    @NotNull
    private Duration emitterTimeout;
}
