package com.crewsafe.weather.fixture;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/** Location and end-of-scenario behaviour for deterministic weather replay. */
@ConfigurationProperties(prefix = "app.weather.fixture")
@Validated
@Getter
@Setter
public class WeatherFixtureProperties {

    @NotBlank
    private String resource;

    private boolean loop;
}
