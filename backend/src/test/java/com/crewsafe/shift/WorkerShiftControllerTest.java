package com.crewsafe.shift;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.common.audit.AuditEventRepository;
import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.ReadinessSubmission;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.repository.ReadinessSubmissionRepository;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.shift.service.ShiftService;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** End-to-end coverage of the SCRUM-162 contract implemented by SCRUM-163. */
@AutoConfigureMockMvc
class WorkerShiftControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private ShiftRepository shifts;
    @Autowired private ShiftAssignmentRepository assignments;
    @Autowired private ReadinessSubmissionRepository readinessSubmissions;
    @Autowired private AuditEventRepository auditEvents;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private ShiftService shiftService;

    private Site site;
    private AppUser assignedWorker;
    private AppUser otherWorker;
    private String assignedWorkerToken;
    private String otherWorkerToken;

    @BeforeEach
    void setUp() {
        site = sites.save(new Site("Readiness " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
        assignedWorker = createUser(Role.WORKER);
        otherWorker = createUser(Role.WORKER);
        assignedWorkerToken = mintAccessToken(assignedWorker.getUsername());
        otherWorkerToken = mintAccessToken(otherWorker.getUsername());
    }

    @Test
    void workerReadsCurrentShiftAndLatestReadinessWhileHistoryIsPreserved() throws Exception {
        Shift shift = createAssignedShift(Instant.now().minus(1, ChronoUnit.HOURS),
                Instant.now().plus(7, ChronoUnit.HOURS));

        JsonNode first = objectMapper.readTree(submit(shift.getId(), assignedWorkerToken,
                        readinessBody(true, true, true, List.of("NONE")))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
        JsonNode second = objectMapper.readTree(submit(shift.getId(), assignedWorkerToken,
                        readinessBody(false, true, false, List.of("FATIGUE", "HEADACHE")))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());

        assertThat(first.get("id").asText()).isNotEqualTo(second.get("id").asText());
        assertThat(readinessSubmissions.countByShiftIdAndWorkerId(
                shift.getId(), assignedWorker.getId())).isEqualTo(2);

        mockMvc.perform(get("/api/v1/shifts/me")
                        .header("Authorization", "Bearer " + assignedWorkerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shift.shiftId").value(shift.getId().toString()))
                .andExpect(jsonPath("$.shift.assignment.taskName").value("Outdoor inspection"))
                .andExpect(jsonPath("$.shift.assignment.intensity").value("MODERATE"))
                .andExpect(jsonPath("$.shift.latestReadiness.id").value(second.get("id").asText()))
                .andExpect(jsonPath("$.shift.latestReadiness.fitToWork").value(false))
                .andExpect(jsonPath("$.shift.latestReadiness.symptoms.length()").value(2));

        UUID secondId = UUID.fromString(second.get("id").asText());
        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.READINESS_SUBMITTED))
                .anySatisfy(event -> {
                    assertThat(event.getActorId()).isEqualTo(assignedWorker.getId());
                    assertThat(event.getTargetId()).isEqualTo(secondId);
                    assertThat(event.getTargetType()).isEqualTo("READINESS_SUBMISSION");
                });
    }

    @Test
    void deletingShiftPreservesReadinessHistory() throws Exception {
        Shift shift = createAssignedShift(Instant.now().minus(1, ChronoUnit.HOURS),
                Instant.now().plus(7, ChronoUnit.HOURS));
        JsonNode response = objectMapper.readTree(submit(shift.getId(), assignedWorkerToken,
                        readinessBody(true, true, true, List.of("NONE")))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
        UUID submissionId = UUID.fromString(response.get("id").asText());

        assertThat(shiftService.deleteShift(site.getId(), assignedWorker.getId(), shift.getId()))
                .isTrue();

        assertThat(shifts.findById(shift.getId())).isEmpty();
        assertThat(readinessSubmissions.findById(submissionId)).isPresent();
    }

    @Test
    void workerGetsSoonestFutureShiftOrNullWhenNoneExists() throws Exception {
        Instant now = Instant.now();
        Shift later = createAssignedShift(now.plus(2, ChronoUnit.DAYS),
                now.plus(2, ChronoUnit.DAYS).plus(8, ChronoUnit.HOURS));
        Shift sooner = createAssignedShift(now.plus(2, ChronoUnit.HOURS),
                now.plus(10, ChronoUnit.HOURS));

        mockMvc.perform(get("/api/v1/shifts/me")
                        .header("Authorization", "Bearer " + assignedWorkerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shift.shiftId").value(sooner.getId().toString()))
                .andExpect(jsonPath("$.shift.latestReadiness").isEmpty());

        mockMvc.perform(get("/api/v1/shifts/me")
                        .header("Authorization", "Bearer " + otherWorkerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shift").isEmpty());

        assertThat(later.getId()).isNotEqualTo(sooner.getId());
    }

    @Test
    void anotherWorkerCannotSubmitForTheAssignedWorker() throws Exception {
        Shift shift = createAssignedShift(Instant.now().minus(1, ChronoUnit.HOURS),
                Instant.now().plus(7, ChronoUnit.HOURS));

        submit(shift.getId(), otherWorkerToken,
                readinessBody(true, true, true, List.of("NONE")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("Forbidden"));

        assertThat(readinessSubmissions
                .findFirstByShiftIdAndWorkerIdOrderBySubmittedAtDescIdDesc(
                        shift.getId(), otherWorker.getId())).isEmpty();
    }

    @Test
    void missingShiftReturnsNotFoundWithoutLeakingAssignmentInformation() throws Exception {
        submit(UUID.randomUUID(), assignedWorkerToken,
                readinessBody(true, true, true, List.of("NONE")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    void nonWorkerCannotUseWorkerShiftEndpoints() throws Exception {
        AppUser supervisor = createUser(Role.SUPERVISOR);
        String supervisorToken = mintAccessToken(supervisor.getUsername());
        Shift shift = createAssignedShift(Instant.now().minus(1, ChronoUnit.HOURS),
                Instant.now().plus(7, ChronoUnit.HOURS));

        mockMvc.perform(get("/api/v1/shifts/me")
                        .header("Authorization", "Bearer " + supervisorToken))
                .andExpect(status().isForbidden());
        submit(shift.getId(), supervisorToken,
                readinessBody(true, true, true, List.of("NONE")))
                .andExpect(status().isForbidden());
    }

    @Test
    void readinessRejectsMissingDuplicateAndContradictoryFlags() throws Exception {
        Shift shift = createAssignedShift(Instant.now().minus(1, ChronoUnit.HOURS),
                Instant.now().plus(7, ChronoUnit.HOURS));

        submit(shift.getId(), assignedWorkerToken,
                Map.of("adequateSleep", true, "adequateHydration", true,
                        "symptoms", List.of("NONE")))
                .andExpect(status().isBadRequest());
        submit(shift.getId(), assignedWorkerToken,
                readinessBody(true, true, true, List.of("FATIGUE", "FATIGUE")))
                .andExpect(status().isBadRequest());
        submit(shift.getId(), assignedWorkerToken,
                readinessBody(true, true, true, List.of("NONE", "HEADACHE")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void readinessSchemaHasNoFreeTextMedicalColumn() {
        List<String> columnTypes = jdbcTemplate.queryForList("""
                SELECT data_type
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'readiness_submission'
                """, String.class);

        assertThat(columnTypes).isNotEmpty().doesNotContain("character varying", "text", "character");

        String symptomConstraint = jdbcTemplate.queryForObject("""
                SELECT pg_get_constraintdef(schema_constraint.oid)
                FROM pg_constraint schema_constraint
                JOIN pg_class table_info ON table_info.oid = schema_constraint.conrelid
                WHERE table_info.relname = 'readiness_submission_symptom'
                  AND schema_constraint.contype = 'c'
                """, String.class);
        assertThat(symptomConstraint).contains("NONE", "MUSCLE_CRAMPS", "OTHER");
    }

    private AppUser createUser(Role role) {
        String username = "readiness-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), "Readiness " + role, role));
    }

    private Shift createAssignedShift(Instant startsAt, Instant endsAt) {
        Shift shift = shifts.save(new Shift(site.getId(), startsAt, endsAt));
        assignments.save(new ShiftAssignment(shift.getId(), assignedWorker.getId(),
                "Outdoor inspection", Intensity.MODERATE, 2));
        return shift;
    }

    private Map<String, Object> readinessBody(boolean fitToWork, boolean adequateSleep,
            boolean adequateHydration, List<String> symptoms) {
        return Map.of(
                "fitToWork", fitToWork,
                "adequateSleep", adequateSleep,
                "adequateHydration", adequateHydration,
                "symptoms", symptoms);
    }

    private ResultActions submit(UUID shiftId, String token, Object body) throws Exception {
        return mockMvc.perform(post(
                        "/api/v1/shifts/" + shiftId + "/readiness")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }
}
