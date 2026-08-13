package com.crewsafe.operation;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.operation.api.AlertCountResponse;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.domain.Approval;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.repository.ActionDispatchRepository;
import com.crewsafe.operation.repository.ApprovalRepository;
import com.crewsafe.operation.repository.RecommendationRepository;
import com.crewsafe.operation.service.ActionDispatchService;
import com.crewsafe.operation.service.ActionStatusSnapshotService;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Runs the real thing, not a mock of it: a real Postgres database via Testcontainers, the
 * actual V13 migration, and the actual JPQL in {@code ActionDispatchRepository} -- none of
 * which the mocked unit tests ever execute. If the {@code approval.recommendation.shiftId}
 * path traversal in {@code findByShiftId}, or the sweep's cutoff queries, don't translate
 * the way they do in a human's head, this is where it shows up.
 *
 * <p>{@code Shift} has no production path to {@code ACTIVE} yet -- nothing in this codebase
 * calls it, {@code ShiftService} only ever creates {@code PLANNED} shifts and transitions
 * out of them to {@code CANCELLED}. That's a pre-existing gap shared with {@code
 * ConditionsSnapshotService} (SCRUM-168), not something SCRUM-324 introduces, but it does
 * mean {@link ActionStatusSnapshotService#getDispatchesForSite} can't be exercised against a
 * shift built through the public API today. {@link ReflectionTestUtils} forces the field
 * directly so this test can still prove the query layer works once a shift does become
 * ACTIVE by whatever future ticket adds that transition.
 *
 * <p>Stops short of asserting on the SSE HTTP response body, matching {@code
 * LightningEndToEndTest}'s judgment call: the stream's first event is written by a
 * background scheduled task, so asserting on it over MockMvc races that thread. {@code
 * ActionStatusSnapshotService} is the same code the stream calls on every tick, so calling
 * it directly here proves the same thing without the flakiness -- and {@code
 * ActionStatusStreamAuthorizationTest}/{@code ActionStatusStreamServiceTest} already cover
 * the HTTP and SSE-framing layers respectively.
 *
 * @author Jemilin Beulah
 */
class ActionDispatchEndToEndTest extends AbstractIntegrationTest {

    private static final MutableClock CLOCK = new MutableClock(Instant.parse("2026-08-13T09:00:00Z"));

    @DynamicPropertySource
    static void shortSweepWindows(DynamicPropertyRegistry registry) {
        registry.add("app.action-dispatch.ack-window", () -> "3m");
        registry.add("app.action-dispatch.auto-complete-window", () -> "15m");
    }

    @Autowired private SiteRepository sites;
    @Autowired private ShiftRepository shifts;
    @Autowired private RecommendationRepository recommendations;
    @Autowired private ApprovalRepository approvals;
    @Autowired private ActionDispatchRepository dispatches;
    @Autowired private AppUserRepository users;
    @Autowired private ActionDispatchService actionDispatchService;
    @Autowired private ActionStatusSnapshotService snapshotService;

    @Test
    void aPendingDispatchGoesLateAndAnAcknowledgedOneAutoCompletesAgainstRealPostgres() {
        Site site = sites.save(new Site("Action Dispatch E2E Site " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));

        Shift shift = new Shift(site.getId(), Instant.parse("2026-08-13T08:00:00Z"),
                Instant.parse("2026-08-13T16:00:00Z"));
        ReflectionTestUtils.setField(shift, "status", ShiftStatus.ACTIVE);
        shifts.save(shift);

        AppUser supervisor = users.save(new AppUser("e2e-supervisor-" + UUID.randomUUID(),
                UUID.randomUUID().toString(), "E2E Supervisor", Role.SUPERVISOR));
        AppUser workerLate = users.save(new AppUser("e2e-worker-late-" + UUID.randomUUID(),
                UUID.randomUUID().toString(), "E2E Worker Late", Role.WORKER));
        AppUser workerAutoComplete = users.save(new AppUser("e2e-worker-autocomplete-" + UUID.randomUUID(),
                UUID.randomUUID().toString(), "E2E Worker Auto-complete", Role.WORKER));

        ActionDispatch pending = dispatchFor(shift, supervisor, workerLate, "STOP_WORK",
                ActionDispatch.ActionDispatchStatus.PENDING, dispatch -> dispatch.setDispatchedAt(CLOCK.instant()));
        ActionDispatch acknowledged = dispatchFor(shift, supervisor, workerAutoComplete, "REST_10_MIN",
                ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED, dispatch -> dispatch.setStartTime(CLOCK.instant()));

        // Before either window has elapsed: both dispatches still sit in their starting state.
        assertThat(snapshotService.toAlertCount(site.getId(), snapshotService.getDispatchesForSite(site.getId())))
                .isEqualTo(new AlertCountResponse(site.getId(), 1, 0, 1, 0, CLOCK.instant()));

        // Past the 3-minute ack-window, short of the 15-minute auto-complete window. The
        // sweep is deliberately global (SCRUM-317's "one sweep over PENDING/ACKNOWLEDGED
        // rows", not scoped per site), and this suite's shared Testcontainers Postgres
        // accumulates leftover rows from other test classes in the same JVM run -- so this
        // asserts on this test's own two rows, not on the sweep's global return count.
        CLOCK.advance(Duration.ofMinutes(4));
        actionDispatchService.markLateDispatches();
        actionDispatchService.autoCompleteDispatches();

        ActionDispatch pendingReloaded = dispatches.findById(pending.getId()).orElseThrow();
        assertThat(pendingReloaded.getStatus()).isEqualTo(ActionDispatch.ActionDispatchStatus.LATE);
        assertThat(pendingReloaded.getLateAt()).isEqualTo(CLOCK.instant());
        ActionDispatch stillAcknowledged = dispatches.findById(acknowledged.getId()).orElseThrow();
        assertThat(stillAcknowledged.getStatus()).isEqualTo(ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED);

        // Past the 15-minute auto-complete window (from the acknowledged dispatch's startTime).
        CLOCK.advance(Duration.ofMinutes(12));
        actionDispatchService.autoCompleteDispatches();

        ActionDispatch acknowledgedReloaded = dispatches.findById(acknowledged.getId()).orElseThrow();
        assertThat(acknowledgedReloaded.getStatus()).isEqualTo(ActionDispatch.ActionDispatchStatus.COMPLETED);
        assertThat(acknowledgedReloaded.getCompletedBy()).isEqualTo(ActionDispatch.CompletionSource.SYSTEM);
        assertThat(acknowledgedReloaded.getEndTime()).isEqualTo(CLOCK.instant());

        // The same query the SSE stream runs on every tick reflects both transitions.
        List<ActionDispatch> forSite = snapshotService.getDispatchesForSite(site.getId());
        assertThat(forSite).extracting(ActionDispatch::getId)
                .containsExactlyInAnyOrder(pending.getId(), acknowledged.getId());
        assertThat(snapshotService.toAlertCount(site.getId(), forSite))
                .isEqualTo(new AlertCountResponse(site.getId(), 0, 1, 0, 1, CLOCK.instant()));
    }

    private ActionDispatch dispatchFor(Shift shift, AppUser supervisor, AppUser worker, String actionCode,
                                        ActionDispatch.ActionDispatchStatus status,
                                        Consumer<ActionDispatch> extra) {
        Recommendation recommendation = recommendations.save(Recommendation.builder()
                .id(UUID.randomUUID())
                .shiftId(shift.getId())
                .status(Recommendation.RecommendationStatus.APPROVED)
                .createdAt(CLOCK.instant())
                .build());

        Approval approval = approvals.save(Approval.builder()
                .id(UUID.randomUUID())
                .recommendation(recommendation)
                .approver(supervisor)
                .decision(Approval.ApprovalDecision.APPROVED)
                .decidedAt(CLOCK.instant())
                .build());

        ActionDispatch dispatch = ActionDispatch.builder()
                .id(UUID.randomUUID())
                .approval(approval)
                .worker(worker)
                .actionCode(actionCode)
                .status(status)
                .dispatchedAt(CLOCK.instant())
                .build();
        extra.accept(dispatch);

        return dispatches.save(dispatch);
    }

    @TestConfiguration
    static class ClockOverride {

        @Bean
        @Primary
        Clock actionDispatchEndToEndTestClock() {
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
