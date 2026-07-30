package com.crewsafe.weather;

import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/** Selects exactly one environmental data source for an application instance. */
@ConfigurationProperties(prefix = "app.weather.data")
@Validated
@Getter
@Setter
public class WeatherDataProperties {

    @Pattern(regexp = "live|fixture", message = "weather data mode must be 'live' or 'fixture'")
    private String mode;
}
