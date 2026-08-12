package com.crewsafe.observability.health;

import com.crewsafe.weather.nea.NeaWeatherClient;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.actuate.health.Health;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Maintains a bounded, status-only observation of NEA reachability. */
@Component
@Slf4j
public class NeaHealthMonitor implements AutoCloseable {

    private final NeaWeatherClient client;
    private final NeaHealthProperties properties;
    private final Clock clock;
    private final ExecutorService checkExecutor = Executors.newSingleThreadExecutor(
            daemonThreadFactory("crewsafe-nea-health-check"));
    private volatile ScheduledExecutorService scheduler;
    private volatile Observation observation = new Observation(false, null);

    public NeaHealthMonitor(NeaWeatherClient client, NeaHealthProperties properties, Clock clock) {
        this.client = client;
        this.properties = properties;
        this.clock = clock;
    }

    @PostConstruct
    void start() {
        ScheduledExecutorService newScheduler = Executors.newSingleThreadScheduledExecutor(
                daemonThreadFactory("crewsafe-nea-health-scheduler"));
        scheduler = newScheduler;
        newScheduler.scheduleWithFixedDelay(this::checkSafely, 0,
                properties.getObservationInterval().toMillis(), TimeUnit.MILLISECONDS);
    }

    /** Performs one bounded observation. Exposed for deterministic tests and smoke checks. */
    public void checkNow() {
        Future<?> future = checkExecutor.submit(
                () -> client.checkReachability(properties.getMaxAttempts()));
        try {
            future.get(properties.getObservationTimeout().toMillis(), TimeUnit.MILLISECONDS);
            observation = new Observation(true, clock.instant());
        } catch (TimeoutException exception) {
            future.cancel(true);
            recordFailure("timeout");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            future.cancel(true);
            recordFailure("interrupted");
        } catch (ExecutionException exception) {
            recordFailure("adapter_error");
        } catch (RuntimeException exception) {
            recordFailure("health_check_error");
        }
    }

    public boolean isHealthy() {
        Observation current = observation;
        return current.up()
                && current.checkedAt() != null
                && !clock.instant().isAfter(current.checkedAt()
                        .plus(properties.getMaximumObservationAge()));
    }

    public Health health() {
        return isHealthy() ? Health.up().build() : Health.down().build();
    }

    private void checkSafely() {
        try {
            checkNow();
        } catch (RuntimeException exception) {
            // A scheduler must not die because a dependency or an unexpected adapter path
            // failed. The public health state remains generic and unhealthy.
            recordFailure("scheduler_error");
        }
    }

    private void recordFailure(String reason) {
        observation = new Observation(false, clock.instant());
        log.warn("nea_health_check_failed reason={}", reason);
    }

    @PreDestroy
    @Override
    public void close() {
        ScheduledExecutorService currentScheduler = scheduler;
        if (currentScheduler != null) {
            currentScheduler.shutdownNow();
        }
        checkExecutor.shutdownNow();
    }

    private static java.util.concurrent.ThreadFactory daemonThreadFactory(String name) {
        return runnable -> {
            Thread thread = new Thread(runnable, name);
            thread.setDaemon(true);
            return thread;
        };
    }

    private record Observation(boolean up, Instant checkedAt) {
    }
}
