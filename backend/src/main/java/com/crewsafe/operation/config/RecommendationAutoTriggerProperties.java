package com.crewsafe.operation.config;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/**
 * The lead window the SCRUM-291 auto-trigger applies to a {@code PLANNED} shift's
 * shift-state guard: {@code status == ACTIVE OR (status == PLANNED AND now >= startsAt -
 * leadWindow)}. Same shape as {@link com.crewsafe.operation.config.ActionDispatchProperties}'s
 * {@code ackWindow}/{@code autoCompleteWindow}.
 *
 * <p>Default 30 minutes because that is {@code LightningRiskProperties}'s own strike-validity
 * window -- a longer lead window buys nothing for the lightning trigger, since a strike more
 * than 30 minutes before a shift starts will already have aged out of relevance by the time
 * the shift begins.
 *
 * @author Abu Bakar
 */
@ConfigurationProperties(prefix = "app.recommendation.auto-trigger")
@Validated
@Getter
@Setter
public class RecommendationAutoTriggerProperties {

    @NotNull
    private Duration leadWindow;
}
