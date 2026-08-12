package com.crewsafe.observability.health;

import com.crewsafe.weather.nea.NeaWeatherClient;
import com.crewsafe.weather.nea.NeaMetric;
import com.crewsafe.weather.nea.NeaObservation;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicInteger;

/** Deterministic, isolated fixtures shared by health-probe tests. */
final class HealthTestFixtures {

    private HealthTestFixtures() {
    }

    static MutableClock clock(Instant initial) {
        return new MutableClock(initial);
    }

    static ControllableNeaClient neaClient() {
        return new ControllableNeaClient();
    }

    static final class MutableClock extends Clock {
        private volatile Instant instant;

        MutableClock(Instant instant) {
            this.instant = instant;
        }

        void advance(java.time.Duration duration) {
            instant = instant.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }

    static final class ControllableNeaClient implements NeaWeatherClient {
        private final AtomicInteger attempts = new AtomicInteger();
        private volatile RuntimeException failure;
        private volatile boolean block;

        @Override
        public NeaObservation fetch(NeaMetric metric) {
            throw new UnsupportedOperationException("health fixture only");
        }

        @Override
        public void checkReachability(int maxAttempts) {
            attempts.incrementAndGet();
            if (block) {
                try {
                    Thread.sleep(10_000);
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new RuntimeException("interrupted", exception);
                }
            }
            if (failure != null) {
                throw failure;
            }
        }

        int attempts() {
            return attempts.get();
        }

        void failWith(RuntimeException exception) {
            failure = exception;
        }

        void recover() {
            failure = null;
            block = false;
        }

        void block() {
            block = true;
        }
    }
}
