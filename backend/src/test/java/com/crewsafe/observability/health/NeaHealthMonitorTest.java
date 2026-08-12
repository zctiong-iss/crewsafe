package com.crewsafe.observability.health;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

class NeaHealthMonitorTest {

    private final HealthTestFixtures.MutableClock clock =
            HealthTestFixtures.clock(Instant.parse("2026-08-12T00:00:00Z"));
    private final HealthTestFixtures.ControllableNeaClient client =
            HealthTestFixtures.neaClient();
    private final NeaHealthProperties properties = properties();
    private final NeaHealthMonitor monitor = new NeaHealthMonitor(client, properties, clock);

    @AfterEach
    void closeMonitor() {
        monitor.close();
    }

    @Test
    void startsDownUntilTheFirstSuccessfulObservation() {
        assertThat(monitor.isHealthy()).isFalse();
        assertThat(monitor.health().getDetails()).isEmpty();

        monitor.checkNow();

        assertThat(monitor.isHealthy()).isTrue();
        assertThat(monitor.health().getStatus().getCode()).isEqualTo("UP");
        assertThat(client.attempts()).isEqualTo(1);
    }

    @Test
    void failedObservationMakesHealthDownAndRecoveryDoesNotNeedRestart() {
        monitor.checkNow();
        client.failWith(new IllegalStateException("upstream details must not escape"));

        monitor.checkNow();

        assertThat(monitor.isHealthy()).isFalse();
        assertThat(monitor.health().getStatus().getCode()).isEqualTo("DOWN");
        assertThat(monitor.health().getDetails()).isEmpty();

        client.recover();
        monitor.checkNow();

        assertThat(monitor.isHealthy()).isTrue();
    }

    @Test
    void successfulObservationExpiresAfterTheConfiguredMaximumAge() {
        monitor.checkNow();
        clock.advance(Duration.ofSeconds(31));

        assertThat(monitor.isHealthy()).isFalse();
        assertThat(monitor.health().getStatus().getCode()).isEqualTo("DOWN");
    }

    @Test
    void healthAttemptUsesOneAdapterAttemptAndReturnsWithinTheBoundedTimeout() {
        client.block();
        long started = System.nanoTime();

        assertThatCode(monitor::checkNow).doesNotThrowAnyException();

        long elapsedMillis = Duration.ofNanos(System.nanoTime() - started).toMillis();
        assertThat(elapsedMillis).isLessThan(500);
        assertThat(client.attempts()).isEqualTo(1);
        assertThat(monitor.isHealthy()).isFalse();
    }

    @Test
    void configurationDefaultsAreSafeForHealthChecks() {
        NeaHealthProperties defaults = new NeaHealthProperties();

        assertThat(defaults.getObservationInterval()).isEqualTo(Duration.ofSeconds(30));
        assertThat(defaults.getMaximumObservationAge()).isEqualTo(Duration.ofSeconds(60));
        assertThat(defaults.getObservationTimeout()).isEqualTo(Duration.ofSeconds(4));
        assertThat(defaults.getMaxAttempts()).isOne();
    }

    private NeaHealthProperties properties() {
        NeaHealthProperties result = new NeaHealthProperties();
        result.setObservationInterval(Duration.ofSeconds(10));
        result.setMaximumObservationAge(Duration.ofSeconds(30));
        result.setObservationTimeout(Duration.ofMillis(50));
        result.setMaxAttempts(1);
        return result;
    }
}
