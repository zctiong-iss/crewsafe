package com.crewsafe.weather.nea;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/**
 * Connection settings for the data.gov.sg real-time weather APIs.
 *
 * @author Bryan Phang
 */
@ConfigurationProperties(prefix = "app.nea")
@Validated
@Getter
@Setter
public class NeaApiProperties {

    @NotBlank
    private String baseUrl;

    /** Optional in development; data.gov.sg recommends a key for production workloads. */
    private String apiKey;

    @NotNull
    private Duration connectTimeout;

    @NotNull
    private Duration readTimeout;
}
