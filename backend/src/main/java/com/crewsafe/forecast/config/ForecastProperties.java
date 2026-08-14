package com.crewsafe.forecast.config;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.net.URI;
import java.time.Duration;
import java.util.Set;

/** Connection settings for CrewSafe's private Python forecast service. */
@ConfigurationProperties(prefix = "app.forecast")
@Validated
public class ForecastProperties {

    private static final Set<String> ALLOWED_SCHEMES = Set.of("http", "https");

    @NotNull
    private URI baseUrl = URI.create("http://localhost:8000");

    @NotNull
    private Duration connectTimeout = Duration.ofSeconds(1);

    @NotNull
    private Duration readTimeout = Duration.ofSeconds(3);

    public URI getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(URI baseUrl) {
        this.baseUrl = baseUrl;
    }

    public Duration getConnectTimeout() {
        return connectTimeout;
    }

    public void setConnectTimeout(Duration connectTimeout) {
        this.connectTimeout = connectTimeout;
    }

    public Duration getReadTimeout() {
        return readTimeout;
    }

    public void setReadTimeout(Duration readTimeout) {
        this.readTimeout = readTimeout;
    }

    @AssertTrue(message = "forecast URL must use HTTP(S) and timeouts must be positive")
    boolean hasSafeConnectionSettings() {
        return baseUrl != null
                && ALLOWED_SCHEMES.contains(baseUrl.getScheme())
                && baseUrl.getHost() != null
                && connectTimeout != null
                && !connectTimeout.isZero()
                && !connectTimeout.isNegative()
                && readTimeout != null
                && !readTimeout.isZero()
                && !readTimeout.isNegative();
    }
}
