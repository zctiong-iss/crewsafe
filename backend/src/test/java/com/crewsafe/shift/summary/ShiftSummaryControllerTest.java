package com.crewsafe.shift.summary;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.common.audit.AuditEvent;
import com.crewsafe.common.audit.AuditEventRepository;
import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.ReadinessSubmission;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.repository.ReadinessSubmissionRepository;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import com.crewsafe.weather.repository.WeatherObservationRepository.InsertObservationCommand;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * SCRUM-139 (US-44) shift close-out summary: the audit-reconciled totals endpoint and its
 * shift-scoped CSV export.
 *
 * <p>The cases that carry the weight are reconciliation and scope. The summary's whole promise is
 * that a total on screen is a {@code COUNT(*)} of the shift's own audit rows — so the anchor test
 * seeds a known mix, adds a decoy on a second shift, and asserts the decoy never counts. The authz
 * cases pin the deliberate difference from the manager-only audit trail: a member supervisor reads
 * their site's shift summaries, a worker cannot, and a supervisor from another site cannot.
 *
 * @author Tang Chee Seng
 */
@AutoConfigureMockMvc
class ShiftSummaryControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private SiteRepository sites;
    @Autowired private ShiftRepository shifts;
    @Autowired private ShiftAssignmentRepository assignments;
    @Autowired private ReadinessSubmissionRepository readiness;
    @Autowired private WeatherObservationRepository weather;
    @Autowired private AuditEventRepository auditEvents;

    private Site site;
    private AppUser supervisor;
    private String supervisorToken;
    private String workerToken;
    private String otherSiteSupervisorToken;

    @BeforeEach
    void setUp() {
        site = sites.save(new Site("Summary " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
        supervisor = memberOf(site, Role.SUPERVISOR);
        supervisorToken = mintAccessToken(supervisor.getUsername());
        workerToken = mintAccessToken(memberOf(site, Role.WORKER).getUsername());

        Site otherSite = sites.save(new Site("Other " + UUID.randomUUID(),
                new BigDecimal("1.310000"), new BigDecimal("103.810000")));
        otherSiteSupervisorToken = mintAccessToken(memberOf(otherSite, Role.SUPERVISOR).getUsername());
    }

    @Test
    void totalsReconcileWithTheShiftsOwnAuditRowsAndExcludeOtherShifts() throws Exception {
        Instant start = Instant.now().minus(3, ChronoUnit.HOURS);
        Instant end = Instant.now().minus(1, ChronoUnit.HOURS);
        Shift shift = shifts.save(new Shift(site.getId(), start, end));
        assignments.save(new ShiftAssignment(shift.getId(), plainWorker().getId(), "Rebar", Intensity.HEAVY, 2));
        assignments.save(new ShiftAssignment(shift.getId(), plainWorker().getId(), "Formwork", Intensity.MODERATE, null));

        // Three SHIFT-targeted lifecycle events + one readiness resolved through its own shift_id.
        shiftEvent(shift, AuditEventType.SHIFT_CREATED, supervisor.getId());
        shiftEvent(shift, AuditEventType.SHIFT_ACTIVATED, null);
        shiftEvent(shift, AuditEventType.SHIFT_CLOSED, supervisor.getId());
        readinessEvent(shift, plainWorker());

        // Decoy: a second shift with its own event, which must never count toward this shift.
        Shift decoy = shifts.save(new Shift(site.getId(), start, end));
        shiftEvent(decoy, AuditEventType.SHIFT_CREATED, supervisor.getId());

        summary(shift, supervisorToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shiftId").value(shift.getId().toString()))
                .andExpect(jsonPath("$.workerCount").value(2))
                .andExpect(jsonPath("$.totalAuditEvents").value(4))
                .andExpect(jsonPath("$.eventCountsByType.SHIFT_CREATED").value(1))
                .andExpect(jsonPath("$.eventCountsByType.READINESS_SUBMITTED").value(1))
                .andExpect(jsonPath("$.conditions.readinessSubmissions").value(1));
    }

    @Test
    void peakBandClassifiesTheHighestWbgtInsideTheShiftWindow() throws Exception {
        Instant start = Instant.now().minus(3, ChronoUnit.HOURS);
        Instant end = Instant.now().minus(1, ChronoUnit.HOURS);
        Shift shift = shifts.save(new Shift(site.getId(), start, end));

        observation(start.plus(10, ChronoUnit.MINUTES), new BigDecimal("31.50"));
        observation(start.plus(40, ChronoUnit.MINUTES), new BigDecimal("32.40")); // the peak, in-window
        observation(end.plus(30, ChronoUnit.MINUTES), new BigDecimal("35.00"));    // hotter, but after the shift

        summary(shift, supervisorToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.conditions.peakWbgt").value(32.40))
                .andExpect(jsonPath("$.conditions.peakBand").value("32_TO_BELOW_33"));
    }

    @Test
    void noReadingInTheWindowYieldsANullBandNotTheCoolestOne() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(),
                Instant.now().minus(3, ChronoUnit.HOURS), Instant.now().minus(1, ChronoUnit.HOURS)));

        summary(shift, supervisorToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.conditions.peakWbgt").doesNotExist())
                .andExpect(jsonPath("$.conditions.peakBand").doesNotExist());
    }

    @Test
    void closedByAndClosedAtAreReadFromTheCloseEvent() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(),
                Instant.now().minus(3, ChronoUnit.HOURS), Instant.now().minus(1, ChronoUnit.HOURS)));
        shiftEvent(shift, AuditEventType.SHIFT_CLOSED, supervisor.getId());

        summary(shift, supervisorToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.closedByName").value(supervisor.getDisplayName()))
                .andExpect(jsonPath("$.closedAt").exists());
    }

    @Test
    void anUnclosedShiftHasNoCloseFieldsButStillSummarises() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(),
                Instant.now().minus(1, ChronoUnit.HOURS), Instant.now().plus(1, ChronoUnit.HOURS)));
        shiftEvent(shift, AuditEventType.SHIFT_CREATED, supervisor.getId());

        summary(shift, supervisorToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PLANNED"))
                .andExpect(jsonPath("$.closedByName").doesNotExist())
                .andExpect(jsonPath("$.closedAt").doesNotExist());
    }

    @Test
    void aClosedShiftRejectsEdits() throws Exception {
        // Immutability is already enforced by ShiftService#assertEditable (SCRUM-266/442); this
        // pins it as a guard against a future edit-path bypassing the rule — an acceptance clause.
        Shift closed = new Shift(site.getId(),
                Instant.now().minus(3, ChronoUnit.HOURS), Instant.now().minus(2, ChronoUnit.HOURS));
        closed.close();
        shifts.save(closed);

        mockMvc.perform(patch("/api/v1/sites/" + site.getId() + "/shifts/" + closed.getId())
                        .header("Authorization", "Bearer " + supervisorToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"startsAt\":\"" + Instant.now().plus(1, ChronoUnit.HOURS)
                                + "\",\"endsAt\":\"" + Instant.now().plus(2, ChronoUnit.HOURS) + "\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void exportStreamsAShiftScopedCsvWithAVerifiableChecksum() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(),
                Instant.now().minus(3, ChronoUnit.HOURS), Instant.now().minus(1, ChronoUnit.HOURS)));
        shiftEvent(shift, AuditEventType.SHIFT_CREATED, supervisor.getId());
        shiftEvent(shift, AuditEventType.SHIFT_CLOSED, supervisor.getId());

        String csv = exportCsv(shift, supervisorToken)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String printed = csv.lines()
                .filter(line -> line.startsWith("# sha256,"))
                .map(line -> line.split(",")[1])
                .findFirst().orElseThrow();

        assertThat(csv)
                .contains("occurred_at,actor,event,event_type")
                .contains("# shift_id," + shift.getId());
        assertThat(printed).isEqualTo(sha256(dataSection(csv)));
    }

    @Test
    void exportIsRecordedAgainstTheShift() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(),
                Instant.now().minus(3, ChronoUnit.HOURS), Instant.now().minus(1, ChronoUnit.HOURS)));
        shiftEvent(shift, AuditEventType.SHIFT_CREATED, supervisor.getId());

        exportCsv(shift, supervisorToken).andExpect(status().isOk());

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.AUDIT_EXPORTED))
                .anyMatch(e -> shift.getId().equals(e.getTargetId()) && supervisor.getId().equals(e.getActorId()));
    }

    @Test
    void aWorkerCannotReadTheSummary() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(),
                Instant.now().minus(3, ChronoUnit.HOURS), Instant.now().minus(1, ChronoUnit.HOURS)));

        summary(shift, workerToken).andExpect(status().isForbidden());
    }

    @Test
    void aSupervisorFromAnotherSiteIsForbidden() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(),
                Instant.now().minus(3, ChronoUnit.HOURS), Instant.now().minus(1, ChronoUnit.HOURS)));

        summary(shift, otherSiteSupervisorToken).andExpect(status().isForbidden());
    }

    @Test
    void aMissingShiftIs404WithAnErrorBody() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + site.getId() + "/shifts/" + UUID.randomUUID() + "/summary")
                        .header("Authorization", "Bearer " + supervisorToken))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").exists());
    }

    /* --------------------------------- helpers --------------------------------- */

    private AppUser memberOf(Site s, Role role) {
        String username = "summary-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), "Summary " + role, role));
        memberships.save(new SiteMembership(created.getId(), s.getId()));
        return created;
    }

    /** An app_user row that only needs to exist for a foreign key (shift_assignment.worker_id,
     *  readiness_submission.worker_id) — no Cognito identity, since it never authenticates. */
    private AppUser plainWorker() {
        return users.save(new AppUser("worker-" + UUID.randomUUID(),
                UUID.randomUUID().toString(), "Worker", Role.WORKER));
    }

    private void shiftEvent(Shift shift, String eventType, UUID actorId) {
        auditEvents.save(new AuditEvent(actorId, eventType, "SHIFT", shift.getId(),
                "req-" + UUID.randomUUID(), eventType + " on shift"));
    }

    /** A real readiness_submission row plus its audit event, so the effective-shift join resolves
     *  it through {@code readiness_submission.shift_id} exactly as production does. */
    private void readinessEvent(Shift shift, AppUser worker) {
        ReadinessSubmission submission = readiness.save(
                new ReadinessSubmission(shift.getId(), worker.getId(), true, true, true, Set.of()));
        auditEvents.save(new AuditEvent(worker.getId(), AuditEventType.READINESS_SUBMITTED,
                "READINESS_SUBMISSION", submission.getId(), "req-" + UUID.randomUUID(), "Readiness submitted"));
    }

    private void observation(Instant observedAt, BigDecimal wbgt) {
        weather.insertIfAbsent(new InsertObservationCommand(
                UUID.randomUUID(), site.getId(), wbgt,
                new BigDecimal("30.00"), new BigDecimal("80.00"), new BigDecimal("5.00"), new BigDecimal("0.00"),
                observedAt, Instant.now(), "MANUAL", "LIVE", "TEST"));
    }

    private ResultActions summary(Shift shift, String token) throws Exception {
        return mockMvc.perform(get("/api/v1/sites/" + site.getId() + "/shifts/" + shift.getId() + "/summary")
                .header("Authorization", "Bearer " + token));
    }

    /** Drives the streaming CSV endpoint through its second, async dispatch — the body is empty
     *  until {@code asyncDispatch} runs. */
    private ResultActions exportCsv(Shift shift, String token) throws Exception {
        MvcResult started = mockMvc.perform(
                        get("/api/v1/sites/" + site.getId() + "/shifts/" + shift.getId() + "/summary/export.csv")
                                .header("Authorization", "Bearer " + token))
                .andExpect(request().asyncStarted())
                .andReturn();
        return mockMvc.perform(asyncDispatch(started));
    }

    private static String dataSection(String csv) {
        return csv.lines()
                .takeWhile(line -> !line.startsWith("#"))
                .reduce("", (acc, line) -> acc + line + "\r\n");
    }

    private static String sha256(String content) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(content.getBytes(StandardCharsets.UTF_8)));
    }
}
