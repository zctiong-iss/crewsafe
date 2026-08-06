package com.crewsafe.lightning.fixture;

import com.crewsafe.lightning.nea.NeaLightningObservation;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.core.io.Resource;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** @author Jemilin Beulah */
class FixtureNeaLightningClientTest {

    private static final Instant NOW = Instant.parse("2026-08-06T09:00:00Z");

    @Test
    void everyFrameIsAnchoredToNowRegardlessOfTheFixtureSBakedInDates() {
        FixtureNeaLightningClient client = client(false);

        NeaLightningObservation first = client.fetchLatest();
        NeaLightningObservation second = client.fetchLatest();

        // The JSON dates these "2026-07-30" — proving the client ignores them and uses the
        // clock is exactly what stops a demo replayed weeks later from always reading CLEAR.
        assertThat(first.observedAt()).isEqualTo(NOW);
        assertThat(second.observedAt()).isEqualTo(NOW);
    }

    @Test
    void aStrikeKeepsItsAuthoredOffsetBeforeTheTickItWasReportedIn() {
        FixtureNeaLightningClient client = client(false);
        client.fetchLatest(); // frame 0: no strikes

        NeaLightningObservation second = client.fetchLatest();

        // Frame 1's JSON: observedAt 08:02:00, strike struckAt 08:01:40 -- 20 seconds earlier.
        assertThat(second.strikes()).singleElement().satisfies(strike -> {
            assertThat(strike.struckAt()).isEqualTo(NOW.minusSeconds(20));
            assertThat(strike.type()).isEqualTo("C");
        });
    }

    @Test
    void replaysEachFrameOnceAndHoldsTheFinalOne() {
        FixtureNeaLightningClient client = client(false);

        client.fetchLatest(); // frame 0: empty
        client.fetchLatest(); // frame 1: advisory-range strike
        client.fetchLatest(); // frame 2: stop-work-range strike
        client.fetchLatest(); // frame 3: closer stop-work-range strike
        NeaLightningObservation fifth = client.fetchLatest(); // frame 4: empty, last frame
        NeaLightningObservation held = client.fetchLatest();

        assertThat(fifth.strikes()).isEmpty();
        assertThat(held.strikes()).isEmpty();
        assertThat(client.fetchLatest().strikes()).isEmpty();
    }

    @Test
    void everyFrameIsMarkedSimulated() {
        FixtureNeaLightningClient client = client(false);

        assertThat(client.fetchLatest().simulated()).isTrue();
    }

    @Test
    void loopingReplayReturnsToTheFirstFrame() {
        FixtureNeaLightningClient client = client(true);

        for (int i = 0; i < 5; i++) {
            client.fetchLatest();
        }

        // Frame 0 has no strikes; looping back to it after the escalation proves the cursor
        // wrapped rather than holding on frame 4.
        assertThat(client.fetchLatest().strikes()).isEmpty();
    }

    @Test
    void rejectsAStrikeTimestampedAfterItsOwnFramesTick() {
        String fixtureWithFutureStrike = """
                {
                  "capturedAt": "2026-07-30T08:45:00Z",
                  "description": "invalid",
                  "frames": [{
                    "observedAt": "2026-07-30T08:00:00Z",
                    "strikes": [
                      {"latitude": 1.36, "longitude": 103.84, "struckAt": "2026-07-30T08:00:05Z", "type": "C"}
                    ]
                  }]
                }
                """;

        assertThatThrownBy(() -> clientFromJson(fixtureWithFutureStrike))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("timestamped after its own frame");
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

    private FixtureNeaLightningClient client(boolean loop) {
        LightningFixtureProperties properties = new LightningFixtureProperties();
        properties.setResource("classpath:lightning/fixtures/nea-demo-replay.json");
        properties.setLoop(loop);
        ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
        return new FixtureNeaLightningClient(objectMapper, new DefaultResourceLoader(), properties,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private FixtureNeaLightningClient clientFromJson(String fixtureJson) {
        LightningFixtureProperties properties = new LightningFixtureProperties();
        properties.setResource("memory:lightning-fixture.json");
        properties.setLoop(false);
        Resource fixtureResource = new ByteArrayResource(
                fixtureJson.getBytes(StandardCharsets.UTF_8), "lightning-fixture.json");
        DefaultResourceLoader resourceLoader = new DefaultResourceLoader() {
            @Override
            public Resource getResource(String location) {
                return fixtureResource;
            }
        };
        ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
        return new FixtureNeaLightningClient(objectMapper, resourceLoader, properties,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }
}
