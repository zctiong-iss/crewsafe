package com.crewsafe.operation.config;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/**
 * The late-derivation and auto-complete windows the SCRUM-324 sweep applies, per the
 * SCRUM-317 contract. Same shape as {@link com.crewsafe.conditions.config.ConditionsStreamProperties}.
 *
 * @author Jemilin Beulah
 */
@ConfigurationProperties(prefix = "app.action-dispatch")
@Validated
@Getter
@Setter
public class ActionDispatchProperties {

    @NotNull
    private Duration ackWindow;

    @NotNull
    private Duration autoCompleteWindow;
}
