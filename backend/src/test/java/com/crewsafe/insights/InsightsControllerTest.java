package com.crewsafe.insights;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.common.audit.AuditEvent;
import com.crewsafe.common.audit.AuditEventRepository;
import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.domain.ActionDispatch.ActionDispatchStatus;
import com.crewsafe.operation.domain.ActionDispatch.CompletionSource;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.domain.Recommendation.RecommendationStatus;
import com.crewsafe.operation.repository.ActionDispatchRepository;
import com.crewsafe.operation.repository.RecommendationRepository;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The SCRUM-433 compliance & response-time report.
 *
 * <p>The case that carries the weight is the outcome partition: a dispatched action is acted on
 * (a human answered), lapsed (the sweep stepped in), or still pending (unresolved, and so left
 * out of the rate). The histogram case pins the other half — response time comes from correlating
 * the {@code ACTION_ACKNOWLEDGED} audit event back to its dispatch, since the dispatch row itself
 * records no ack timestamp.
 *
 * @author Tang Chee Seng
 */
@AutoConfigureMockMvc
class InsightsControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private AppUserRepository users;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private SiteRepository sites;
    @Autowired private ShiftRepository shifts;
    @Autowired private RecommendationRepository recommendations;
    @Autowired private ActionDispatchRepository dispatches;
    @Autowired private AuditEventRepository auditEvents;

    private Site site;
    private AppUser worker;
    private Recommendation recommendation;
    private String supervisorToken;
    private Instant from;
    private Instant to;

    @BeforeEach
    void setUp() {
        site = sites.save(new Site("Insights " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
        supervisorToken = mintAccessToken(user(Role.SUPERVISOR).getUsername());
        worker = user(Role.WORKER);

        Shift shift = shifts.save(new Shift(site.getId(), Instant.now(), Instant.now().plusSeconds(28800)));
        recommendation = recommendations.save(Recommendation.builder()
                .id(UUID.randomUUID())
                .shiftId(shift.getId())
                .status(RecommendationStatus.APPROVED)
                .createdAt(Instant.now())
                .build());

        from = Instant.now().minus(1, ChronoUnit.HOURS);
        to = Instant.now().plus(1, ChronoUnit.HOURS);
    }

    @Test
    void partitionsDispatchesIntoActedOnLapsedAndExcludesPending() throws Exception {
        UUID acked = dispatch(ActionDispatchStatus.ACKNOWLEDGED, null, secondsAgo(90)).getId();
        UUID completedByWorker = dispatch(ActionDispatchStatus.COMPLETED, CompletionSource.WORKER, secondsAgo(30)).getId();
        dispatch(ActionDispatchStatus.LATE, null, secondsAgo(1000));               // lapsed
        dispatch(ActionDispatchStatus.COMPLETED, CompletionSource.SYSTEM, secondsAgo(500)); // lapsed
        dispatch(ActionDispatchStatus.PENDING, null, secondsAgo(10));              // unresolved -> excluded
        ack(acked);
        ack(completedByWorker);

        ComplianceReport report = report(supervisorToken);

        assertThat(report.dispatched()).isEqualTo(4);
        assertThat(report.actedOn()).isEqualTo(2);
        assertThat(report.lapsed()).isEqualTo(2);
        assertThat(report.complianceRate()).isEqualTo(0.5);
        // The day buckets sum back to the totals — nothing counted twice or dropped.
        assertThat(report.compliance()).isNotEmpty();
        assertThat(report.compliance().stream().mapToInt(b -> b.dispatched()).sum()).isEqualTo(4);
        assertThat(report.compliance().stream().mapToInt(b -> b.actedOn()).sum()).isEqualTo(2);
    }

    @Test
    void summarisesAcknowledgementResponseTimesFromAuditEvents() throws Exception {
        // Response time = ack.occurredAt (now) - dispatchedAt (backdated), so ~30s and ~90s.
        ack(dispatch(ActionDispatchStatus.COMPLETED, CompletionSource.WORKER, secondsAgo(30)).getId());
        ack(dispatch(ActionDispatchStatus.ACKNOWLEDGED, null, secondsAgo(90)).getId());

        ComplianceReport report = report(supervisorToken);

        // p50 is the lower of the two (~30s), p95 the upper (~90s); allow for the ms of test skew.
        assertThat(report.p50ResponseSeconds()).isBetween(29.0, 33.0);
        assertThat(report.p95ResponseSeconds()).isBetween(89.0, 93.0);
        // 30s falls in the 0–1m band, 90s in the 1–2m band; the bands are always present in order.
        assertThat(bandCount(report, "0–1m")).isEqualTo(1);
        assertThat(bandCount(report, "1–2m")).isEqualTo(1);
        assertThat(bandCount(report, "2–5m")).isZero();
    }

    @Test
    void aSiteWithNoDispatchesReportsZeroAndNullPercentiles() throws Exception {
        ComplianceReport report = report(supervisorToken);

        assertThat(report.dispatched()).isZero();
        assertThat(report.complianceRate()).isZero();
        assertThat(report.p50ResponseSeconds()).isNull();
        assertThat(report.p95ResponseSeconds()).isNull();
        assertThat(report.compliance()).isEmpty();
        // The latency bands are still emitted (all zero) so the chart keeps a stable x-axis.
        assertThat(report.responseTimes()).hasSize(5);
    }

    @Test
    void aWorkerCannotReadTheComplianceReport() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + site.getId() + "/insights/compliance")
                        .param("from", from.toString()).param("to", to.toString())
                        .header("Authorization", "Bearer " + mintAccessToken(user(Role.WORKER).getUsername())))
                .andExpect(status().isForbidden());
    }

    /* --------------------------------- helpers --------------------------------- */

    private AppUser user(Role role) {
        String username = "insights-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), "Insights " + role, role));
        memberships.save(new SiteMembership(created.getId(), site.getId()));
        return created;
    }

    private static Instant secondsAgo(long seconds) {
        return Instant.now().minusSeconds(seconds);
    }

    private ActionDispatch dispatch(ActionDispatchStatus status, CompletionSource completedBy, Instant dispatchedAt) {
        return dispatches.save(ActionDispatch.builder()
                .id(UUID.randomUUID())
                .recommendation(recommendation)
                .worker(worker)
                .actionCode("REST_10_MIN")
                .status(status)
                .completedBy(completedBy)
                .dispatchedAt(dispatchedAt)
                .build());
    }

    /** Records the acknowledgement audit event the response-time query correlates by target. */
    private void ack(UUID dispatchId) {
        auditEvents.save(new AuditEvent(worker.getId(), AuditEventType.ACTION_ACKNOWLEDGED,
                "ACTION_DISPATCH", dispatchId, "corr-" + UUID.randomUUID(), "Action acknowledged"));
    }

    private static int bandCount(ComplianceReport report, String label) {
        return report.responseTimes().stream()
                .filter(b -> b.label().equals(label))
                .mapToInt(ComplianceReport.ResponseTimeBucket::count)
                .findFirst().orElseThrow();
    }

    private ComplianceReport report(String token) throws Exception {
        String body = mockMvc.perform(get("/api/v1/sites/" + site.getId() + "/insights/compliance")
                        .param("from", from.toString()).param("to", to.toString())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(body, ComplianceReport.class);
    }
}
