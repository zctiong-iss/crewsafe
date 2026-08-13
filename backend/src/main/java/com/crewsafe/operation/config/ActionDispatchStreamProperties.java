package com.crewsafe.operation.config;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/**
 * Cadence and connection lifetime for the SCRUM-317 action-status SSE stream. Same shape
 * as {@link com.crewsafe.conditions.config.ConditionsStreamProperties} (SCRUM-168).
 *
 * @author Jemilin Beulah
 */
@ConfigurationProperties(prefix = "app.action-dispatch.stream")
@Validated
@Getter
@Setter
public class ActionDispatchStreamProperties {

    @NotNull
    private Duration pushInterval;

    @NotNull
    private Duration emitterTimeout;
}
