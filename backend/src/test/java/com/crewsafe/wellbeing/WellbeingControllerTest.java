package com.crewsafe.wellbeing;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.domain.SymptomFlag;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.wellbeing.domain.Concern;
import com.crewsafe.wellbeing.repository.ConcernRepository;
import com.crewsafe.wellbeing.repository.WellbeingLogRepository;
import com.crewsafe.wellbeing.service.WellbeingService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * A worker reporting how they are coping, and a supervisor seeing it (US-11).
 *
 * <p>The cases worth the most attention are the two authorization ones. A worker logging rest on a
 * shift they are not assigned to would put strangers in a supervisor's crew view, and a worker
 * acknowledging their own concern would defeat the entire point of the OPEN state.
 *
 * @author Justin Chua
 */
@AutoConfigureMockMvc
class WellbeingControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private AppUserRepository users;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private SiteRepository sites;
    @Autowired private ShiftRepository shifts;
    @Autowired private ShiftAssignmentRepository assignments;
    @Autowired private WellbeingLogRepository logs;
    @Autowired private ConcernRepository concerns;
    @Autowired private WellbeingService wellbeing;

    private Site site;
    private Shift shift;
    private AppUser worker;
    private AppUser otherWorker;
    private AppUser supervisor;
    private AppUser safetyManager;
    private String workerToken;
    private String otherWorkerToken;
    private String supervisorToken;
    private String safetyManagerToken;

    @BeforeEach
    void setUp() {
        site = sites.save(new Site("Wellbeing " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));

        worker = user(Role.WORKER);
        otherWorker = user(Role.WORKER);
        supervisor = user(Role.SUPERVISOR);
        safetyManager = user(Role.SAFETY_MANAGER);

        workerToken = mintAccessToken(worker.getUsername());
        otherWorkerToken = mintAccessToken(otherWorker.getUsername());
        supervisorToken = mintAccessToken(supervisor.getUsername());
        safetyManagerToken = mintAccessToken(safetyManager.getUsername());

        Instant now = Instant.now();
        shift = shifts.save(new Shift(site.getId(), now.minus(1, ChronoUnit.HOURS),
                now.plus(5, ChronoUnit.HOURS)));
        assignments.save(new ShiftAssignment(shift.getId(), worker.getId(), "Kerb laying",
                Intensity.HEAVY, 3));
    }

    /* ------------------------------- worker logging ------------------------------- */

    @Test
    void workerLogsRestAndHydration() throws Exception {
        postJson("/api/v1/shifts/" + shift.getId() + "/wellbeing-logs", workerToken,
                        Map.of("logType", "REST"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.logType").value("REST"))
                // A log a worker made themselves, not one they were told to make.
                .andExpect(jsonPath("$.source").value("SELF"));

        postJson("/api/v1/shifts/" + shift.getId() + "/wellbeing-logs", workerToken,
                        Map.of("logType", "HYDRATION"))
                .andExpect(status().isCreated());

        assertThat(logs.findByShiftIdAndWorkerIdOrderByLoggedAtDescIdDesc(shift.getId(), worker.getId()))
                .hasSize(2);
    }

    @Test
    void everyLogIsANewFactRatherThanAnUpdate() throws Exception {
        for (int i = 0; i < 3; i++) {
            postJson("/api/v1/shifts/" + shift.getId() + "/wellbeing-logs", workerToken,
                    Map.of("logType", "HYDRATION")).andExpect(status().isCreated());
        }

        // Three drinks are three rows. Collapsing them to a "last drink" column would lose the
        // thing a supervisor actually reads: whether someone is drinking often enough.
        assertThat(logs.findByShiftIdAndWorkerIdOrderByLoggedAtDescIdDesc(shift.getId(), worker.getId()))
                .hasSize(3);
    }

    @Test
    void aWorkerCannotLogAgainstAShiftTheyAreNotOn() throws Exception {
        postJson("/api/v1/shifts/" + shift.getId() + "/wellbeing-logs", otherWorkerToken,
                        Map.of("logType", "REST"))
                .andExpect(status().isBadRequest());

        // Otherwise a supervisor's crew view would show wellbeing for people who were never there.
        assertThat(logs.findByShiftIdOrderByLoggedAtDescIdDesc(shift.getId())).isEmpty();
    }

    @Test
    void aSupervisorCannotLogWellbeing() throws Exception {
        // Not a worker, so there is no assignment to log against. Offering the endpoint would
        // only ever produce a failure.
        postJson("/api/v1/shifts/" + shift.getId() + "/wellbeing-logs", supervisorToken,
                        Map.of("logType", "REST"))
                .andExpect(status().isForbidden());
    }

    /* -------------------------------- concerns -------------------------------- */

    @Test
    void workerRaisesAConcernWithSymptomsAndANote() throws Exception {
        postJson("/api/v1/shifts/" + shift.getId() + "/concerns", workerToken,
                        concernBody(List.of("DIZZINESS", "HEADACHE"), "Feeling faint since the last break"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("OPEN"))
                .andExpect(jsonPath("$.symptoms.length()").value(2))
                .andExpect(jsonPath("$.acknowledgedAt").doesNotExist());
    }

    @Test
    void aConcernMayCarryOnlySymptoms() throws Exception {
        // The note is optional on purpose: a worker must never be unable to report that they are
        // struggling because they cannot write in a language their supervisor reads.
        postJson("/api/v1/shifts/" + shift.getId() + "/concerns", workerToken,
                        concernBody(List.of("NAUSEA"), null))
                .andExpect(status().isCreated());
    }

    @Test
    void anEmptyConcernIsRefused() throws Exception {
        // Nothing to act on, but it would still cost a supervisor the trip to look at it.
        postJson("/api/v1/shifts/" + shift.getId() + "/concerns", workerToken,
                        concernBody(List.of(), null))
                .andExpect(status().isBadRequest());

        postJson("/api/v1/shifts/" + shift.getId() + "/concerns", workerToken,
                        concernBody(List.of("NONE"), "   "))
                .andExpect(status().isBadRequest());
    }

    @Test
    void supervisorSeesTheConcernAndAcknowledgesItOnce() throws Exception {
        UUID concernId = raiseConcern();

        getAuthenticated("/api/v1/sites/" + site.getId() + "/concerns", supervisorToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].status").value("OPEN"));

        mockMvc.perform(post("/api/v1/sites/" + site.getId() + "/concerns/" + concernId + "/acknowledge")
                        .header("Authorization", "Bearer " + supervisorToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACKNOWLEDGED"))
                .andExpect(jsonPath("$.acknowledgedAt").exists());

        // A second acknowledgement is a conflict, not an overwrite: who got there first is the
        // fact worth keeping.
        mockMvc.perform(post("/api/v1/sites/" + site.getId() + "/concerns/" + concernId + "/acknowledge")
                        .header("Authorization", "Bearer " + supervisorToken))
                .andExpect(status().isConflict());
    }

    @Test
    void aSafetyManagerReadsConcernsButCannotAcknowledgeThem() throws Exception {
        UUID concernId = raiseConcern();

        getAuthenticated("/api/v1/sites/" + site.getId() + "/concerns", safetyManagerToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));

        // Acknowledging claims someone acted. Oversight is not the same as responding.
        mockMvc.perform(post("/api/v1/sites/" + site.getId() + "/concerns/" + concernId + "/acknowledge")
                        .header("Authorization", "Bearer " + safetyManagerToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void aWorkerCannotAcknowledgeTheirOwnConcern() throws Exception {
        UUID concernId = raiseConcern();

        // The whole value of the OPEN state is that somebody other than the reporter has seen it.
        mockMvc.perform(post("/api/v1/sites/" + site.getId() + "/concerns/" + concernId + "/acknowledge")
                        .header("Authorization", "Bearer " + workerToken))
                .andExpect(status().isForbidden());

        assertThat(concerns.findById(concernId)).get()
                .extracting(c -> c.getStatus().name())
                .isEqualTo("OPEN");
    }

    @Test
    void openConcernSnapshotIsNewestFirstAndExcludesAcknowledgedConcerns() {
        Instant base = Instant.parse("2026-08-20T08:00:00Z");
        Concern older = concerns.save(Concern.raise(shift.getId(), worker.getId(),
                Set.of(SymptomFlag.HEADACHE), null, base));
        Concern acknowledged = Concern.raise(shift.getId(), worker.getId(),
                Set.of(SymptomFlag.NAUSEA), null, base.plusSeconds(30));
        acknowledged.acknowledge(supervisor.getId(), base.plusSeconds(40));
        concerns.save(acknowledged);
        Concern newer = concerns.save(Concern.raise(shift.getId(), worker.getId(),
                Set.of(SymptomFlag.DIZZINESS), null, base.plusSeconds(60)));

        assertThat(wellbeing.openConcernsForSite(site.getId()))
                .extracting(Concern::getId)
                .containsExactly(newer.getId(), older.getId());
    }

    /* ------------------------------ supervisor view ------------------------------ */

    @Test
    void crewWellbeingReportsTheLatestOfEachPerWorker() throws Exception {
        postJson("/api/v1/shifts/" + shift.getId() + "/wellbeing-logs", workerToken,
                Map.of("logType", "REST")).andExpect(status().isCreated());
        postJson("/api/v1/shifts/" + shift.getId() + "/wellbeing-logs", workerToken,
                Map.of("logType", "HYDRATION")).andExpect(status().isCreated());
        postJson("/api/v1/shifts/" + shift.getId() + "/wellbeing-logs", workerToken,
                Map.of("logType", "HYDRATION")).andExpect(status().isCreated());

        getAuthenticated("/api/v1/sites/" + site.getId() + "/shifts/" + shift.getId() + "/wellbeing",
                        supervisorToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].workerId").value(worker.getId().toString()))
                .andExpect(jsonPath("$[0].lastRestAt").exists())
                .andExpect(jsonPath("$[0].lastRestSource").value("SELF"))
                .andExpect(jsonPath("$[0].restCount").value(1))
                .andExpect(jsonPath("$[0].hydrationCount").value(2));
    }

    @Test
    void aShiftFromAnotherSiteReadsAs404() throws Exception {
        Site otherSite = sites.save(new Site("Other " + UUID.randomUUID(),
                new BigDecimal("1.310000"), new BigDecimal("103.810000")));
        memberships.save(new SiteMembership(supervisor.getId(), otherSite.getId()));

        // Scoped through the site, so a shift id from elsewhere is absent rather than readable.
        getAuthenticated("/api/v1/sites/" + otherSite.getId() + "/shifts/" + shift.getId() + "/wellbeing",
                        supervisorToken)
                .andExpect(status().isNotFound());
    }

    /* --------------------------------- helpers --------------------------------- */

    private AppUser user(Role role) {
        String username = "wellbeing-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), "Wellbeing " + role, role));
        memberships.save(new SiteMembership(created.getId(), site.getId()));
        return created;
    }

    private UUID raiseConcern() throws Exception {
        String body = postJson("/api/v1/shifts/" + shift.getId() + "/concerns", workerToken,
                        concernBody(List.of("DIZZINESS"), "Light-headed"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(objectMapper.readTree(body).get("id").asText());
    }

    /** Null-safe: a body with no note at all is a case the contract allows. */
    private Map<String, Object> concernBody(List<String> symptoms, String note) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("symptoms", symptoms);
        if (note != null) {
            body.put("note", note);
        }
        return body;
    }

    private ResultActions getAuthenticated(String url, String token) throws Exception {
        return mockMvc.perform(get(url).header("Authorization", "Bearer " + token));
    }

    private ResultActions postJson(String url, String token, Object body) throws Exception {
        return mockMvc.perform(post(url)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }
}
