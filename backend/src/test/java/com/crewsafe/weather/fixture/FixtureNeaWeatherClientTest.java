package com.crewsafe.weather.fixture;

import com.crewsafe.weather.nea.NeaMetric;
import com.crewsafe.weather.nea.NeaObservation;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.core.io.Resource;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FixtureNeaWeatherClientTest {

    @Test
    void replaysOneCoherentSimulatedFramePerFetchAndHoldsTheFinalFrame() {
        FixtureNeaWeatherClient client = client(false);

        List<NeaObservation> first = client.fetchAll();
        List<NeaObservation> second = client.fetchAll();
        List<NeaObservation> third = client.fetchAll();
        List<NeaObservation> held = client.fetchAll();

        assertFrame(first, "2026-07-30T08:00:00Z", "30.8");
        assertFrame(second, "2026-07-30T08:15:00Z", "32.2");
        assertFrame(third, "2026-07-30T08:30:00Z", "33.1");
        assertFrame(held, "2026-07-30T08:30:00Z", "33.1");
    }

    @Test
    void loopingReplayReturnsToTheFirstFrame() {
        FixtureNeaWeatherClient client = client(true);

        client.fetchAll();
        client.fetchAll();
        client.fetchAll();

        assertFrame(client.fetchAll(), "2026-07-30T08:00:00Z", "30.8");
    }

    @Test
    void singleMetricReadDoesNotAdvanceTheReplay() {
        FixtureNeaWeatherClient client = client(false);

        NeaObservation first = client.fetch(NeaMetric.WBGT);
        NeaObservation same = client.fetch(NeaMetric.WBGT);

        assertThat(first.observedAt()).isEqualTo(Instant.parse("2026-07-30T08:00:00Z"));
        assertThat(same).isEqualTo(first);
    }

    @Test
    void healthReachabilityIsDeterministicAndDoesNotAdvanceTheReplay() {
        FixtureNeaWeatherClient client = client(false);

        client.checkReachability(1);

        assertThat(client.fetch(NeaMetric.WBGT).observedAt())
                .isEqualTo(Instant.parse("2026-07-30T08:00:00Z"));
    }

    @Test
    void rejectsFixtureWithoutScenarioDescription() {
        String fixtureWithoutDescription = """
                {
                  "capturedAt": "2026-07-30T08:45:00Z",
                  "frames": [{}]
                }
                """;

        assertThatThrownBy(() -> clientFromJson(fixtureWithoutDescription))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("capturedAt, description, and at least one frame");
    }

    private FixtureNeaWeatherClient client(boolean loop) {
        WeatherFixtureProperties properties = new WeatherFixtureProperties();
        properties.setResource("classpath:weather/fixtures/nea-demo-replay.json");
        properties.setLoop(loop);
        ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
        return new FixtureNeaWeatherClient(objectMapper, new DefaultResourceLoader(), properties);
    }

    private FixtureNeaWeatherClient clientFromJson(String fixtureJson) {
        WeatherFixtureProperties properties = new WeatherFixtureProperties();
        properties.setResource("memory:weather-fixture.json");
        properties.setLoop(false);
        Resource fixtureResource = new ByteArrayResource(
                fixtureJson.getBytes(StandardCharsets.UTF_8), "weather-fixture.json");
        DefaultResourceLoader resourceLoader = new DefaultResourceLoader() {
            @Override
            public Resource getResource(String location) {
                return fixtureResource;
            }
        };
        ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
        return new FixtureNeaWeatherClient(objectMapper, resourceLoader, properties);
    }

    private void assertFrame(List<NeaObservation> frame, String observedAt, String wbgt) {
        assertThat(frame).extracting(NeaObservation::metric)
                .containsExactly(NeaMetric.values());
        assertThat(frame).allSatisfy(observation -> {
            assertThat(observation.observedAt()).isEqualTo(Instant.parse(observedAt));
            assertThat(observation.simulated()).isTrue();
            assertThat(observation.readings()).hasSize(2);
        });
        NeaObservation wbgtObservation = frame.get(0);
        assertThat(wbgtObservation.readings().get(0).value()).isEqualByComparingTo(wbgt);
    }
}
