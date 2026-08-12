package com.crewsafe.observability.health;

import com.crewsafe.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import com.crewsafe.weather.nea.NeaWeatherClient;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.junit.jupiter.api.Assertions.assertTrue;

@AutoConfigureMockMvc
@Import(HealthEndpointTest.HealthEndpointTestConfiguration.class)
@TestPropertySource(properties = "spring.main.allow-bean-definition-overriding=true")
class HealthEndpointTest extends AbstractIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private NeaHealthMonitor monitor;

    @Autowired
    private MutableDatabaseHealthIndicator dbHealthContributor;

    @MockitoBean
    private NeaWeatherClient neaWeatherClient;

    @BeforeEach
    void healthyBaseline() {
        dbHealthContributor.setHealthy(true);
        doNothing().when(neaWeatherClient).checkReachability(anyInt());
        monitor.checkNow();
    }

    @Test
    void healthyProbesAreStatusOnlyAndAggregatePathRemainsAvailable() throws Exception {
        mockMvc.perform(get("/actuator/health/liveness"))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"status\":\"UP\"}", true));
        mockMvc.perform(get("/actuator/health/readiness"))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"status\":\"UP\"}", true));
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void databaseFailureMakesReadinessFailWhileLivenessStaysHealthy() throws Exception {
        dbHealthContributor.setHealthy(false);

        mockMvc.perform(get("/actuator/health/readiness"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(content().json("{\"status\":\"DOWN\"}", true));
        mockMvc.perform(get("/actuator/health/liveness"))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"status\":\"UP\"}", true));
    }

    @Test
    void neaFailureMakesReadinessFailAndRecoveryWorksWithoutRestart() throws Exception {
        doThrow(new IllegalStateException("synthetic NEA failure"))
                .when(neaWeatherClient).checkReachability(anyInt());
        monitor.checkNow();

        mockMvc.perform(get("/actuator/health/readiness"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(content().json("{\"status\":\"DOWN\"}", true));
        mockMvc.perform(get("/actuator/health/liveness"))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"status\":\"UP\"}", true));

        doNothing().when(neaWeatherClient).checkReachability(anyInt());
        monitor.checkNow();

        mockMvc.perform(get("/actuator/health/readiness"))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"status\":\"UP\"}", true));
    }

    @Test
    void healthyProbeP95RemainsBelowOneSecond() throws Exception {
        List<Long> durationsNanos = new ArrayList<>();

        for (int i = 0; i < 100; i++) {
            long start = System.nanoTime();
            mockMvc.perform(get("/actuator/health/liveness"))
                    .andExpect(status().isOk());
            durationsNanos.add(System.nanoTime() - start);

            start = System.nanoTime();
            mockMvc.perform(get("/actuator/health/readiness"))
                    .andExpect(status().isOk());
            durationsNanos.add(System.nanoTime() - start);
        }

        Collections.sort(durationsNanos);
        long p95Nanos = durationsNanos.get((int) Math.ceil(durationsNanos.size() * 0.95) - 1);
        assertTrue(p95Nanos < 1_000_000_000L,
                () -> "healthy probe p95 exceeded 1 second: " + p95Nanos + " ns");
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class HealthEndpointTestConfiguration {

        @Bean(name = "dbHealthContributor")
        MutableDatabaseHealthIndicator dbHealthContributor() {
            return new MutableDatabaseHealthIndicator();
        }
    }

    static final class MutableDatabaseHealthIndicator implements HealthIndicator {
        private volatile boolean healthy = true;

        void setHealthy(boolean healthy) {
            this.healthy = healthy;
        }

        @Override
        public Health health() {
            return healthy ? Health.up().build() : Health.down().build();
        }
    }
}
