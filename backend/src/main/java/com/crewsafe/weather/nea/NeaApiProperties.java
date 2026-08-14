package com.crewsafe.weather.nea;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Min;
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

    /** Total attempts for retryable transport, rate-limit, and server failures. */
    @Min(1)
    private int maxAttempts = 3;

    @NotNull
    private Duration initialBackoff = Duration.ofMillis(250);

    @NotNull
    private Duration maxBackoff = Duration.ofSeconds(2);

    /**
     * How long to wait after a 429, when the response does not say.
     *
     * Separate from {@link #initialBackoff} because a rate limit is not a transient blip and
     * does not respond to the same curve. data.gov.sg answers an anonymous caller with
     * "try again in 10 seconds"; the exponential schedule above tops out at two, so all three
     * attempts land inside the penalty window and every one of them is spent failing. Twelve
     * seconds clears the documented window with margin.
     *
     * The real remedy is an API key ({@link #apiKey}), which raises the limit. This keeps
     * ingestion working without one instead of failing every cycle.
     */
    @NotNull
    private Duration rateLimitBackoff = Duration.ofSeconds(12);

    @AssertTrue(message = "NEA retry backoff durations must be positive")
    public boolean isRetryBackoffValid() {
        return isPositive(initialBackoff) && isPositive(maxBackoff)
                && isPositive(rateLimitBackoff);
    }

    private boolean isPositive(Duration duration) {
        return duration != null && !duration.isZero() && !duration.isNegative();
    }
}
