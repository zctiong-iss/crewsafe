package com.crewsafe.shift;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.ReadinessSubmission;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.domain.SymptomFlag;
import com.crewsafe.shift.repository.ReadinessSubmissionRepository;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The SCRUM-437 supervisor readiness summary: for each upcoming shift, who has cleared the
 * pre-shift readiness check, who is stale, and who has not submitted at all.
 *
 * <p>The case worth the most attention is the classification one. "Stale" is a freshness policy
 * the server owns (default 16h), so the test backdates one submission past that window with a
 * direct timestamp write — the entity has no setter for {@code submittedAt} by design, because
 * production only ever sets it to "now" at persist. The other cases pin the two gates every
 * supervisor surface carries: role and site membership.
 *
 * @author Tang Chee Seng
 */
@AutoConfigureMockMvc
class ReadinessSummaryControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private SiteRepository sites;
    @Autowired private ShiftRepository shifts;
    @Autowired private ShiftAssignmentRepository assignments;
    @Autowired private ReadinessSubmissionRepository submissions;
    @Autowired private JdbcTemplate jdbc;

    private Site site;
    private AppUser supervisor;
    private String supervisorToken;

    @BeforeEach
    void setUp() {
        site = sites.save(new Site("Readiness " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
        supervisor = user(Role.SUPERVISOR);
        supervisorToken = mintAccessToken(supervisor.getUsername());
    }

    @Test
    void summaryClassifiesEachRosteredWorkerAndExcludesTheUnassigned() throws Exception {
        Instant now = Instant.now();
        Shift shift = shifts.save(new Shift(site.getId(), now.plus(2, ChronoUnit.HOURS),
                now.plus(10, ChronoUnit.HOURS)));

        AppUser fresh = worker("Anya");        // submitted 1h ago, with a symptom -> SUBMITTED + flagged
        AppUser stale = worker("Bala");        // submitted but backdated 20h -> STALE
        AppUser missing = worker("Chandra");   // rostered, never submitted -> MISSING
        AppUser bystander = worker("Devi");     // submitted, but NOT on the roster -> excluded

        assignments.save(new ShiftAssignment(shift.getId(), fresh.getId(), "Rebar", Intensity.HEAVY, 3));
        assignments.save(new ShiftAssignment(shift.getId(), stale.getId(), "Formwork", Intensity.MODERATE, 3));
        assignments.save(new ShiftAssignment(shift.getId(), missing.getId(), "Signals", Intensity.LIGHT, 3));

        submitReadiness(shift.getId(), fresh.getId(), true, Set.of(SymptomFlag.HEADACHE));
        UUID staleId = submitReadiness(shift.getId(), stale.getId(), true, Set.of(SymptomFlag.NONE));
        backdate(staleId, now.minus(20, ChronoUnit.HOURS));
        // The bystander submitted but is not assigned — the roster, not the submission table,
        // decides who appears, so this row must not leak into another shift's crew.
        submitReadiness(shift.getId(), bystander.getId(), true, Set.of(SymptomFlag.NONE));

        summary(site.getId(), supervisorToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.siteId").value(site.getId().toString()))
                .andExpect(jsonPath("$.shifts.length()").value(1))
                .andExpect(jsonPath("$.shifts[0].submitted").value(1))
                .andExpect(jsonPath("$.shifts[0].stale").value(1))
                .andExpect(jsonPath("$.shifts[0].missing").value(1))
                .andExpect(jsonPath("$.shifts[0].workers.length()").value(3))
                // the fresh worker
                .andExpect(jsonPath("$.shifts[0].workers[?(@.workerId=='" + fresh.getId() + "')].status")
                        .value("SUBMITTED"))
                .andExpect(jsonPath("$.shifts[0].workers[?(@.workerId=='" + fresh.getId() + "')].fitToWork")
                        .value(true))
                .andExpect(jsonPath("$.shifts[0].workers[?(@.workerId=='" + fresh.getId() + "')].flaggedSymptom")
                        .value(true))
                // the stale worker: a submission exists, but it lapsed and carried no symptom
                .andExpect(jsonPath("$.shifts[0].workers[?(@.workerId=='" + stale.getId() + "')].status")
                        .value("STALE"))
                .andExpect(jsonPath("$.shifts[0].workers[?(@.workerId=='" + stale.getId() + "')].flaggedSymptom")
                        .value(false))
                // the missing worker: nothing to read, so fitness/timestamp are null
                .andExpect(jsonPath("$.shifts[0].workers[?(@.workerId=='" + missing.getId() + "')].status")
                        .value("MISSING"))
                .andExpect(jsonPath("$.shifts[0].workers[?(@.workerId=='" + missing.getId() + "')].fitToWork")
                        .value((Object) null))
                .andExpect(jsonPath("$.shifts[0].workers[?(@.workerId=='" + missing.getId() + "')].submittedAt")
                        .value((Object) null))
                // the bystander never appears — they were not on this roster
                .andExpect(jsonPath("$.shifts[0].workers[?(@.workerId=='" + bystander.getId() + "')]")
                        .isEmpty());
    }

    @Test
    void onlyUpcomingShiftsAppearSoonestFirst() throws Exception {
        Instant now = Instant.now();
        Shift later = shifts.save(new Shift(site.getId(), now.plus(8, ChronoUnit.HOURS),
                now.plus(16, ChronoUnit.HOURS)));
        Shift sooner = shifts.save(new Shift(site.getId(), now.plus(2, ChronoUnit.HOURS),
                now.plus(6, ChronoUnit.HOURS)));
        Shift cancelled = shifts.save(new Shift(site.getId(), now.plus(3, ChronoUnit.HOURS),
                now.plus(7, ChronoUnit.HOURS)));
        cancelled.cancel();
        shifts.save(cancelled);

        // PLANNED shifts show, soonest first; the CANCELLED one is gone.
        summary(site.getId(), supervisorToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shifts.length()").value(2))
                .andExpect(jsonPath("$.shifts[0].shiftId").value(sooner.getId().toString()))
                .andExpect(jsonPath("$.shifts[1].shiftId").value(later.getId().toString()));
    }

    @Test
    void aWorkerCannotReadTheReadinessSummary() throws Exception {
        AppUser worker = user(Role.WORKER);
        // Oversight is a supervisor surface; a worker sees their own check, not the whole crew's.
        summary(site.getId(), mintAccessToken(worker.getUsername()))
                .andExpect(status().isForbidden());
    }

    @Test
    void aSiteTheSupervisorDoesNotBelongToIsForbidden() throws Exception {
        Site otherSite = sites.save(new Site("Other " + UUID.randomUUID(),
                new BigDecimal("1.310000"), new BigDecimal("103.810000")));
        // Right role, wrong site: @siteAccess denies a site the caller has no membership of.
        summary(otherSite.getId(), supervisorToken)
                .andExpect(status().isForbidden());
    }

    /* --------------------------------- helpers --------------------------------- */

    private AppUser user(Role role) {
        String username = "readiness-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), "Readiness " + role, role));
        memberships.save(new SiteMembership(created.getId(), site.getId()));
        return created;
    }

    /** A worker with a stable display name, so roster ordering in the response is predictable. */
    private AppUser worker(String displayName) {
        String username = "readiness-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), displayName, Role.WORKER));
        memberships.save(new SiteMembership(created.getId(), site.getId()));
        return created;
    }

    private UUID submitReadiness(UUID shiftId, UUID workerId, boolean fit, Set<SymptomFlag> symptoms) {
        ReadinessSubmission saved = submissions.save(
                new ReadinessSubmission(shiftId, workerId, fit, true, true, symptoms));
        return saved.getId();
    }

    /** Backdates a submission past the freshness window — the only way to seed a STALE row,
     *  since {@code submitted_at} has no entity setter and defaults to now at persist. */
    private void backdate(UUID submissionId, Instant submittedAt) {
        jdbc.update("UPDATE readiness_submission SET submitted_at = ? WHERE id = ?",
                OffsetDateTime.ofInstant(submittedAt, ZoneOffset.UTC), submissionId);
    }

    private ResultActions summary(UUID siteId, String token) throws Exception {
        return mockMvc.perform(get("/api/v1/sites/" + siteId + "/readiness-summary")
                .header("Authorization", "Bearer " + token));
    }
}
