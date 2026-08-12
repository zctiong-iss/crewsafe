package com.crewsafe.observability.health;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/** Status-only Actuator contributor for the cached NEA observation. */
@Component("nea")
public class NeaHealthIndicator implements HealthIndicator {

    private final NeaHealthMonitor monitor;

    public NeaHealthIndicator(NeaHealthMonitor monitor) {
        this.monitor = monitor;
    }

    @Override
    public Health health() {
        return monitor.health();
    }
}
