package com.crewsafe.lightning.fixture;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Location and end-of-scenario behaviour for deterministic lightning replay.
 *
 * @author Jemilin Beulah
 */
@ConfigurationProperties(prefix = "app.lightning.fixture")
@Validated
@Getter
@Setter
public class LightningFixtureProperties {

    @NotBlank
    private String resource;

    private boolean loop;
}
