package com.crewsafe.lightning;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.conditions.api.ConditionsSnapshot;
import com.crewsafe.conditions.service.ConditionsSnapshotService;
import com.crewsafe.lightning.domain.LightningRiskState;
import com.crewsafe.lightning.ingestion.LightningIngestionService;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Runs the real thing, not a mock of it: fixture mode, a real Postgres database via
 * Testcontainers, and the actual bundled replay scenario, driven through
 * {@code LightningIngestionService} and read back through {@code ConditionsSnapshotService}
 * exactly as the SSE stream would. If the migration, entity mapping, repository query, or
 * derivation logic disagree with each other, this is where it shows up — the other lightning
 * tests each check one layer in isolation with mocks either side of it.
 *
 * <p>Stops short of asserting on the SSE HTTP response body on purpose, matching
 * {@code SiteConditionsAuthorizationTest}'s existing judgment call: the stream's first event
 * is written by a background scheduled task, so asserting on it over MockMvc races that
 * thread. {@code ConditionsSnapshotService} is the same code the stream calls on every tick,
 * so calling it directly here proves the same thing without the flakiness.
 *
 * <p>The clock is overridden and advanced by hand between ticks, matching NEA's real ~2-minute
 * cadence, rather than letting all five {@code ingestCurrentConditions()} calls land on the
 * real clock milliseconds apart. Each fixture strike is only offset a few seconds behind its
 * own tick (see the JSON), so firing ticks faster than that lets an earlier tick's strike
 * outrank a later tick's on {@code nearestStrikeAt} — a test-timing artifact, not something
 * that can happen against the live feed, where every strike carries NEA's own real timestamp.
 *
 * @author Jemilin Beulah
 */
class LightningEndToEndTest extends AbstractIntegrationTest {

    private static final MutableClock CLOCK = new MutableClock(Instant.now());

    @DynamicPropertySource
    static void fixtureMode(DynamicPropertyRegistry registry) {
        registry.add("app.weather.data.mode", () -> "fixture");
    }

    @Autowired
    private SiteRepository sites;

    @Autowired
    private LightningIngestionService ingestionService;

    @Autowired
    private ConditionsSnapshotService snapshotService;

    @Test
    void bundledFixtureDrivesASiteThroughClearAdvisoryAndStopWork() {
        // Same coordinates the fixture's strikes are authored against — see the JSON's
        // description and FixtureNeaLightningClient's javadoc for why the dates don't matter
        // but the site's position relative to the strikes does.
        Site site = sites.save(new Site("Lightning E2E Site " + UUID.randomUUID(),
                new BigDecimal("1.362200"), new BigDecimal("103.845500")));

        // Frame 0: no strikes at all.
        ingest();
        assertThat(stateFor(site)).isEqualTo(LightningRiskState.CLEAR);

        // Frame 1: a strike ~15km out, inside the advisory band but outside stop-work's.
        ingest();
        assertThat(stateFor(site)).isEqualTo(LightningRiskState.ADVISORY);

        // Frame 2: ~9km, now inside the stop-work band.
        ingest();
        assertThat(stateFor(site)).isEqualTo(LightningRiskState.STOP_WORK);

        // Frame 3: ~4km, still stop-work, closer.
        ingest();
        assertThat(stateFor(site)).isEqualTo(LightningRiskState.STOP_WORK);

        // Frame 4: no new strikes, but well within the 30-minute hold, so stop-work stands —
        // and the distance/validity now come from frame 3's strike, the most recent one.
        ingest();
        ConditionsSnapshot afterQuietTick = snapshotService.getSnapshot(site.getId());
        assertThat(afterQuietTick.lightning().state()).isEqualTo(LightningRiskState.STOP_WORK);
        assertThat(afterQuietTick.lightning().nearestStrikeKm()).isEqualByComparingTo("4.01");
        assertThat(afterQuietTick.lightning().validUntil()).isAfter(afterQuietTick.asOf());
    }

    /** Advances the shared clock by one real ingestion interval, then runs a tick against it. */
    private void ingest() {
        CLOCK.advance(Duration.ofMinutes(2));
        ingestionService.ingestCurrentConditions();
    }

    private LightningRiskState stateFor(Site site) {
        return snapshotService.getSnapshot(site.getId()).lightning().state();
    }

    @TestConfiguration
    static class ClockOverride {

        @Bean
        @Primary
        Clock lightningEndToEndTestClock() {
            return CLOCK;
        }
    }

    /** A clock this test can move forward on demand, standing in for real elapsed time. */
    private static final class MutableClock extends Clock {

        private volatile Instant instant;

        MutableClock(Instant instant) {
            this.instant = instant;
        }

        void advance(Duration duration) {
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
}
