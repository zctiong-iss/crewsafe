package com.crewsafe.shift;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.common.audit.AuditEventRepository;
import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
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
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * SCRUM-160: create/list/read a shift and add an assignment to one, plus the site
 * scoping and audit behaviour called for in the implementation plan. Extended by
 * SCRUM-159/160-fix with the two gaps found building SCRUM-161 against the original
 * contract: correct/delete a shift, correct/remove an assignment. Extended by SCRUM-263
 * to assert every 404 in this file carries the standard {@code ErrorResponse} body,
 * not just the status code, and by SCRUM-255 with a status transition: cancel a shift
 * (kept as a record) as an alternative to delete (removed outright).
 *
 * <p>{@link #supervisorFromAnotherSiteCannotCreateAShift()} is the negative *write* test
 * SCRUM-156 formally moved here (see the SCRUM-156↔SCRUM-160 Jira link): SCRUM-156 only
 * covered cross-site *read* denial.
 *
 * @author Abu Bakar
 */
@AutoConfigureMockMvc
class ShiftControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private AuditEventRepository auditEvents;

    private Site siteA;
    private Site siteB;
    private AppUser supervisorA;
    private AppUser workerA;
    private String supervisorAToken;
    private String supervisorBToken;

    private AppUser user(Role role) {
        String username = "shift-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), "Shift Test " + role, role));
    }

    private Site site(String label) {
        return sites.save(new Site("Shift " + label + " " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
    }

    @BeforeEach
    void setUp() {
        siteA = site("Site A");
        siteB = site("Site B");

        supervisorA = user(Role.SUPERVISOR);
        workerA = user(Role.WORKER);
        AppUser supervisorB = user(Role.SUPERVISOR);

        memberships.save(new SiteMembership(supervisorA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(workerA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(supervisorB.getId(), siteB.getId()));

        supervisorAToken = mintAccessToken(supervisorA.getUsername());
        supervisorBToken = mintAccessToken(supervisorB.getUsername());
    }

    private Map<String, Object> shiftBody(Instant startsAt, Instant endsAt, List<Map<String, Object>> assignments) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("startsAt", startsAt.toString());
        body.put("endsAt", endsAt.toString());
        if (assignments != null) {
            body.put("assignments", assignments);
        }
        return body;
    }

    private Map<String, Object> assignmentBody(UUID workerId, String taskName, String intensity,
                                                Integer acclimatisationDay) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("workerId", workerId.toString());
        if (taskName != null) {
            body.put("taskName", taskName);
        }
        if (intensity != null) {
            body.put("intensity", intensity);
        }
        if (acclimatisationDay != null) {
            body.put("acclimatisationDay", acclimatisationDay);
        }
        return body;
    }

    /** ShiftAssignmentUpdateRequest has no workerId field at all, unlike the create shape. */
    private Map<String, Object> assignmentUpdateBody(String taskName, String intensity,
                                                       Integer acclimatisationDay) {
        Map<String, Object> body = new LinkedHashMap<>();
        if (taskName != null) {
            body.put("taskName", taskName);
        }
        if (intensity != null) {
            body.put("intensity", intensity);
        }
        if (acclimatisationDay != null) {
            body.put("acclimatisationDay", acclimatisationDay);
        }
        return body;
    }

    private ResultActions postJson(String url, String token, Object body) throws Exception {
        return mockMvc.perform(post(url)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    private ResultActions patchJson(String url, String token, Object body) throws Exception {
        return mockMvc.perform(patch(url)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    private ResultActions deleteAuthenticated(String url, String token) throws Exception {
        return mockMvc.perform(delete(url).header("Authorization", "Bearer " + token));
    }
    
    private static final String DEFAULT_CANCEL_REASON = "Bad weather — site closed for the day";

    private ResultActions cancelShift(String shiftId, String token) throws Exception {
        return cancelShift(shiftId, token, DEFAULT_CANCEL_REASON);
    }

    private ResultActions cancelShift(String shiftId, String token, String reason) throws Exception {
        return mockMvc.perform(post("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId + "/cancel")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("reason", reason))));
    }

    private String createShift(Instant startsAt, Instant endsAt) throws Exception {
        return objectMapper.readTree(
                        postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                                        shiftBody(startsAt, endsAt, List.of()))
                                .andExpect(status().isCreated())
                                .andReturn().getResponse().getContentAsString())
                .get("id").asText();
    }

    private String addAssignment(String shiftId, String intensity) throws Exception {
        return objectMapper.readTree(
                        postJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId + "/assignments",
                                        supervisorAToken, assignmentBody(workerA.getId(), "Original task", intensity, null))
                                .andExpect(status().isCreated())
                                .andReturn().getResponse().getContentAsString())
                .get("assignments").get(0).get("id").asText();
    }

    // --- create / read round-trip ---

    @Test
    void supervisorCreatesAShiftWithAnAssignmentAndReadsItBack() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);

        Map<String, Object> body = shiftBody(startsAt, endsAt,
                List.of(assignmentBody(workerA.getId(), "Excavation", "HEAVY", 3)));

        String response = postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken, body)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.siteId").value(siteA.getId().toString()))
                .andExpect(jsonPath("$.status").value("PLANNED"))
                .andExpect(jsonPath("$.assignments.length()").value(1))
                .andExpect(jsonPath("$.assignments[0].workerId").value(workerA.getId().toString()))
                .andExpect(jsonPath("$.assignments[0].taskName").value("Excavation"))
                .andExpect(jsonPath("$.assignments[0].intensity").value("HEAVY"))
                .andExpect(jsonPath("$.assignments[0].acclimatisationDay").value(3))
                .andReturn().getResponse().getContentAsString();

        String shiftId = objectMapper.readTree(response).get("id").asText();

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId)
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(shiftId))
                .andExpect(jsonPath("$.assignments.length()").value(1));
    }

    @Test
    void aShiftCanBeCreatedEmptyAndStaffedLater() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);

        String response = postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                        shiftBody(startsAt, endsAt, List.of()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.assignments.length()").value(0))
                .andReturn().getResponse().getContentAsString();

        String shiftId = objectMapper.readTree(response).get("id").asText();

        postJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId + "/assignments", supervisorAToken,
                        assignmentBody(workerA.getId(), null, "LIGHT", null))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.assignments.length()").value(1))
                .andExpect(jsonPath("$.assignments[0].workerId").value(workerA.getId().toString()))
                .andExpect(jsonPath("$.assignments[0].intensity").value("LIGHT"));
    }

    @Test
    void listShiftsReturnsThisSitesShiftsMostRecentlyCreatedFirst() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);

        String firstId = objectMapper.readTree(
                        postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                                        shiftBody(startsAt, endsAt, List.of()))
                                .andExpect(status().isCreated())
                                .andReturn().getResponse().getContentAsString())
                .get("id").asText();

        String secondId = objectMapper.readTree(
                        postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                                        shiftBody(startsAt, endsAt, List.of()))
                                .andExpect(status().isCreated())
                                .andReturn().getResponse().getContentAsString())
                .get("id").asText();

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/shifts")
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].id").value(secondId))
                .andExpect(jsonPath("$[1].id").value(firstId));
    }

    // --- the moved SCRUM-156 test: cross-site write denial ---

    @Test
    void supervisorFromAnotherSiteCannotCreateAShift() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);

        postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorBToken,
                        shiftBody(startsAt, endsAt, List.of()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("Forbidden"));
    }

    // --- RBAC: creating/staffing a shift is a supervisor-tool action, not a worker one ---

    @Test
    void workerIsForbiddenFromCreatingAShiftEvenAtTheirOwnSite() throws Exception {
        String workerAToken = mintAccessToken(workerA.getUsername());
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);

        postJson("/api/v1/sites/" + siteA.getId() + "/shifts", workerAToken,
                        shiftBody(startsAt, endsAt, List.of()))
                .andExpect(status().isForbidden());
    }

    @Test
    void workerIsForbiddenFromAddingAnAssignmentEvenAtTheirOwnSite() throws Exception {
        String workerAToken = mintAccessToken(workerA.getUsername());
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);

        String shiftId = objectMapper.readTree(
                        postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                                        shiftBody(startsAt, endsAt, List.of()))
                                .andExpect(status().isCreated())
                                .andReturn().getResponse().getContentAsString())
                .get("id").asText();

        postJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId + "/assignments", workerAToken,
                        assignmentBody(workerA.getId(), null, "LIGHT", null))
                .andExpect(status().isForbidden());
    }

    // --- audit ---

    @Test
    void everyShiftCreationWritesASingleAuditEvent() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);

        String response = postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                        shiftBody(startsAt, endsAt,
                                List.of(assignmentBody(workerA.getId(), null, "MODERATE", null))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        UUID shiftId = UUID.fromString(objectMapper.readTree(response).get("id").asText());

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_CREATED))
                .filteredOn(e -> shiftId.equals(e.getTargetId()))
                .hasSize(1)
                .allMatch(e -> supervisorA.getId().equals(e.getActorId()));
    }

    /**
     * ADR-0013 (amended): an audit row must be readable without joining back to the shift,
     * because {@code shift.starts_at} holds instants derived under two different rules — the
     * form's zone handling changed mid-project and nothing in the schema distinguishes them.
     * The row therefore carries the wall clock the shift actually runs on, and the zone it is
     * read in, taken from the site rather than a constant so it stays true off-shore.
     */
    @Test
    void shiftCreationAuditRecordsTheLocalWallClockAndZone() throws Exception {
        Instant startsAt = Instant.parse("2026-08-10T00:00:00Z");   // 08:00 in Asia/Singapore
        Instant endsAt = Instant.parse("2026-08-10T08:00:00Z");     // 16:00 in Asia/Singapore

        String response = postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                        shiftBody(startsAt, endsAt, List.of()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        UUID shiftId = UUID.fromString(objectMapper.readTree(response).get("id").asText());

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_CREATED))
                .filteredOn(e -> shiftId.equals(e.getTargetId()))
                .singleElement()
                .extracting(e -> e.getDetail())
                .isEqualTo("Created shift for site " + siteA.getId()
                        + " (10 Aug 2026 08:00–16:00 Asia/Singapore)");
    }

    /** A shift that runs past local midnight needs both dates, or the range reads backwards. */
    @Test
    void anOvernightShiftAuditNamesBothLocalDates() throws Exception {
        Instant startsAt = Instant.parse("2026-08-10T14:00:00Z");   // 22:00 SGT, 10 Aug
        Instant endsAt = Instant.parse("2026-08-10T22:00:00Z");     // 06:00 SGT, 11 Aug

        String response = postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                        shiftBody(startsAt, endsAt, List.of()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        UUID shiftId = UUID.fromString(objectMapper.readTree(response).get("id").asText());

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_CREATED))
                .filteredOn(e -> shiftId.equals(e.getTargetId()))
                .singleElement()
                .extracting(e -> e.getDetail())
                .isEqualTo("Created shift for site " + siteA.getId()
                        + " (10 Aug 2026 22:00 – 11 Aug 2026 06:00 Asia/Singapore)");
    }

    /**
     * A correction row that omits the corrected times is the least useful row in the log.
     *
     * <p>Anchored to tomorrow's date rather than a hardcoded one: {@link
     * com.crewsafe.shift.service.ShiftService#assertEditable} rejects a PATCH once {@code
     * endsAt} is no longer after the real wall clock, so a fixed past-tense literal (this test
     * previously hardcoded 2026-08-10) is a ticking time bomb that fails the instant the suite
     * runs on or after that date — which is exactly what happened. {@code LocalDate.now(...)}
     * keeps both the corrected shift and the expected audit string true for as long as this
     * test exists, the same pattern {@code Instant.now()} already establishes elsewhere in this
     * file for tests that do not need a fixed, human-readable local time.
     */
    @Test
    void shiftTimeCorrectionAuditRecordsTheNewLocalWallClock() throws Exception {
        ZoneId sgt = ZoneId.of("Asia/Singapore");
        LocalDate correctedDate = LocalDate.now(sgt).plusDays(1);

        String response = postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                        shiftBody(correctedDate.atTime(8, 0).atZone(sgt).toInstant(),
                                correctedDate.atTime(16, 0).atZone(sgt).toInstant(), List.of()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        UUID shiftId = UUID.fromString(objectMapper.readTree(response).get("id").asText());

        patchJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId, supervisorAToken,
                        shiftBody(correctedDate.atTime(9, 0).atZone(sgt).toInstant(),
                                correctedDate.atTime(17, 0).atZone(sgt).toInstant(), null))
                .andExpect(status().isOk());

        String expectedDate = DateTimeFormatter.ofPattern("d MMM uuuu", Locale.UK).format(correctedDate);
        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_UPDATED))
                .filteredOn(e -> shiftId.equals(e.getTargetId()))
                .singleElement()
                .extracting(e -> e.getDetail())
                .isEqualTo("Corrected shift times for site " + siteA.getId()
                        + " to " + expectedDate + " 09:00–17:00 Asia/Singapore");
    }

    /**
     * The audit write is deferred to after-commit precisely so this holds: a shift create
     * that fails to persist (here, an assignment referencing a worker id with no matching
     * {@code app_user} row, violating the {@code shift_assignment} foreign key) must not
     * leave a "shift was created" audit trail behind for work that never actually landed.
     */
    @Test
    void aShiftCreateThatFailsToPersistWritesNoAuditEvent() throws Exception {
        long before = auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_CREATED).stream()
                .filter(e -> supervisorA.getId().equals(e.getActorId()))
                .count();

        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);

        postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                        shiftBody(startsAt, endsAt,
                                List.of(assignmentBody(UUID.randomUUID(), null, "LIGHT", null))))
                .andExpect(status().is5xxServerError());

        long after = auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_CREATED).stream()
                .filter(e -> supervisorA.getId().equals(e.getActorId()))
                .count();

        assertThat(after).isEqualTo(before);
    }

    // --- validation ---

    @Test
    void endsAtBeforeStartsAtIsRejectedAsBadRequest() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.minus(1, ChronoUnit.HOURS);

        postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                        shiftBody(startsAt, endsAt, List.of()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Bad Request"));
    }

    @Test
    void anAssignmentWithoutIntensityIsRejectedAsBadRequest() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);

        postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                        shiftBody(startsAt, endsAt,
                                List.of(assignmentBody(workerA.getId(), "Excavation", null, null))))
                .andExpect(status().isBadRequest());
    }

    // --- not found ---

    @Test
    void readingAnUnknownShiftIdIs404() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/shifts/" + UUID.randomUUID())
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    void addingAnAssignmentToAnUnknownShiftIs404() throws Exception {
        postJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + UUID.randomUUID() + "/assignments",
                        supervisorAToken, assignmentBody(workerA.getId(), null, "LIGHT", null))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    // --- SCRUM-159/160-fix: correct a shift ---

    @Test
    void supervisorCorrectsAShiftsTimes() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);

        Instant correctedStartsAt = startsAt.plus(1, ChronoUnit.HOURS);
        Instant correctedEndsAt = endsAt.plus(1, ChronoUnit.HOURS);

        patchJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId, supervisorAToken,
                        shiftBody(correctedStartsAt, correctedEndsAt, null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(shiftId))
                .andExpect(jsonPath("$.startsAt").value(correctedStartsAt.toString()))
                .andExpect(jsonPath("$.endsAt").value(correctedEndsAt.toString()));

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_UPDATED))
                .anyMatch(e -> UUID.fromString(shiftId).equals(e.getTargetId())
                        && supervisorA.getId().equals(e.getActorId()));
    }

    @Test
    void correctingAShiftWithEndsAtBeforeStartsAtIsBadRequest() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);

        patchJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId, supervisorAToken,
                        shiftBody(endsAt, startsAt, null))
                .andExpect(status().isBadRequest());
    }

    @Test
    void correctingAnUnknownShiftIs404() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);

        patchJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + UUID.randomUUID(), supervisorAToken,
                        shiftBody(startsAt, endsAt, null))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    void workerIsForbiddenFromCorrectingAShift() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);
        String workerAToken = mintAccessToken(workerA.getUsername());

        patchJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId, workerAToken,
                        shiftBody(startsAt, endsAt, null))
                .andExpect(status().isForbidden());
    }

    @Test
    void supervisorFromAnotherSiteCannotCorrectAShift() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);

        patchJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId, supervisorBToken,
                        shiftBody(startsAt, endsAt, null))
                .andExpect(status().isForbidden());
    }

    // --- SCRUM-159/160-fix: delete a shift ---

    @Test
    void supervisorDeletesAShiftAndItsAssignments() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);
        addAssignment(shiftId, "LIGHT");

        deleteAuthenticated("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId, supervisorAToken)
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId)
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isNotFound());

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_DELETED))
                .anyMatch(e -> UUID.fromString(shiftId).equals(e.getTargetId())
                        && supervisorA.getId().equals(e.getActorId()));
    }

    @Test
    void deletingAnUnknownShiftIs404() throws Exception {
        deleteAuthenticated("/api/v1/sites/" + siteA.getId() + "/shifts/" + UUID.randomUUID(), supervisorAToken)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    void workerIsForbiddenFromDeletingAShift() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);
        String workerAToken = mintAccessToken(workerA.getUsername());

        deleteAuthenticated("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId, workerAToken)
                .andExpect(status().isForbidden());
    }

    // --- SCRUM-255: cancel a shift ---

    @Test
    void supervisorCancelsAPlannedShift() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);

        cancelShift(shiftId, supervisorAToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(shiftId))
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId)
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_CANCELLED))
                .anyMatch(e -> UUID.fromString(shiftId).equals(e.getTargetId())
                        && supervisorA.getId().equals(e.getActorId()));
    }

    @Test
    void cancellingAShiftKeepsItsAssignmentsInPlace() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);
        addAssignment(shiftId, "LIGHT");

        cancelShift(shiftId, supervisorAToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignments.length()").value(1));
    }

    /** CANCELLED is terminal (SCRUM-255): there is no un-cancel, so a second cancel is rejected. */
    @Test
    void cancellingAnAlreadyCancelledShiftIsBadRequest() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);

        cancelShift(shiftId, supervisorAToken).andExpect(status().isOk());

        cancelShift(shiftId, supervisorAToken)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Bad Request"));
    }

    @Test
    void cancellingAnUnknownShiftIs404() throws Exception {
        cancelShift(UUID.randomUUID().toString(), supervisorAToken)
                .andExpect(status().isNotFound());
    }

    @Test
    void workerIsForbiddenFromCancellingAShift() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);
        String workerAToken = mintAccessToken(workerA.getUsername());

        cancelShift(shiftId, workerAToken).andExpect(status().isForbidden());
    }

    @Test
    void supervisorFromAnotherSiteCannotCancelAShift() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);

        cancelShift(shiftId, supervisorBToken).andExpect(status().isForbidden());
    }

    @Test
    void cancellationReasonIsRecordedInTheAuditDetail() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);

        cancelShift(shiftId, supervisorAToken, "Client stood down the crew").andExpect(status().isOk());

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_CANCELLED))
                .filteredOn(e -> UUID.fromString(shiftId).equals(e.getTargetId()))
                .singleElement()
                .extracting(e -> e.getDetail())
                .asString()
                .contains("Client stood down the crew");
    }

    /** Reason is required (@NotBlank): a blank one is rejected before any state change. */
    @Test
    void cancellingWithoutAReasonIsBadRequest() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);

        cancelShift(shiftId, supervisorAToken, "   ")
                .andExpect(status().isBadRequest());
    }

    // --- SCRUM-452: staffing a worker onto a shift is audited, from either path ---

    /**
     * The trail recorded assignment corrections and removals from the start but never the
     * original assignment, so it could show a worker being taken off a shift while staying
     * silent on who put them there. Found by generating a real audit export (US-15) and
     * noticing the assignment was missing from it.
     */
    @Test
    void addingAWorkerToAnExistingShiftIsAudited() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        String shiftId = createShift(startsAt, startsAt.plus(8, ChronoUnit.HOURS));
        String assignmentId = addAssignment(shiftId, "HEAVY");

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_ASSIGNMENT_ADDED))
                .filteredOn(e -> UUID.fromString(assignmentId).equals(e.getTargetId()))
                .singleElement()
                .satisfies(e -> {
                    assertThat(e.getActorId()).isEqualTo(supervisorA.getId());
                    assertThat(e.getDetail())
                            .contains("Assigned worker " + workerA.getId())
                            .contains("to shift " + shiftId)
                            .contains("intensity HEAVY");
                });
    }

    /** Same fact, other path: assignments given at creation must be audited identically. */
    @Test
    void workersStaffedAtShiftCreationAreEachAudited() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        AppUser secondWorker = user(Role.WORKER);
        memberships.save(new SiteMembership(secondWorker.getId(), siteA.getId()));

        String response = postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                        shiftBody(startsAt, startsAt.plus(8, ChronoUnit.HOURS), List.of(
                                assignmentBody(workerA.getId(), "Excavation", "HEAVY", 2),
                                assignmentBody(secondWorker.getId(), null, "LIGHT", null))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        String shiftId = objectMapper.readTree(response).get("id").asText();

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_ASSIGNMENT_ADDED))
                .filteredOn(e -> e.getDetail() != null && e.getDetail().contains("to shift " + shiftId))
                .hasSize(2)
                .satisfiesExactlyInAnyOrder(
                        e -> assertThat(e.getDetail())
                                .contains("intensity HEAVY")
                                .contains("acclimatisation day 2")
                                .contains("task Excavation"),
                        // A null acclimatisation day means fully acclimatised, and says so
                        // rather than leaving the clause out and reading as lost data.
                        e -> assertThat(e.getDetail())
                                .contains("intensity LIGHT")
                                .contains("fully acclimatised"));
    }

    /** SHIFT_CREATED stays one-per-shift; the assignment rows are additional, not a change to it. */
    @Test
    void staffingAtCreationStillWritesExactlyOneShiftCreatedEvent() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);

        String response = postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                        shiftBody(startsAt, startsAt.plus(8, ChronoUnit.HOURS),
                                List.of(assignmentBody(workerA.getId(), null, "MODERATE", null))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        UUID shiftId = UUID.fromString(objectMapper.readTree(response).get("id").asText());

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_CREATED))
                .filteredOn(e -> shiftId.equals(e.getTargetId()))
                .hasSize(1);
    }

    // --- SCRUM-159/160-fix: correct an assignment ---

    @Test
    void supervisorCorrectsAnAssignmentsTaskAndIntensity() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);
        String assignmentId = addAssignment(shiftId, "MODERATE");

        patchJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId + "/assignments/" + assignmentId,
                        supervisorAToken, assignmentUpdateBody("Corrected task", "HEAVY", 2))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignments.length()").value(1))
                .andExpect(jsonPath("$.assignments[0].id").value(assignmentId))
                .andExpect(jsonPath("$.assignments[0].workerId").value(workerA.getId().toString()))
                .andExpect(jsonPath("$.assignments[0].taskName").value("Corrected task"))
                .andExpect(jsonPath("$.assignments[0].intensity").value("HEAVY"))
                .andExpect(jsonPath("$.assignments[0].acclimatisationDay").value(2));

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_ASSIGNMENT_UPDATED))
                .anyMatch(e -> UUID.fromString(assignmentId).equals(e.getTargetId())
                        && supervisorA.getId().equals(e.getActorId()));
    }

    @Test
    void correctingAnAssignmentWithoutIntensityIsBadRequest() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);
        String assignmentId = addAssignment(shiftId, "MODERATE");

        patchJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId + "/assignments/" + assignmentId,
                        supervisorAToken, assignmentUpdateBody("Corrected task", null, null))
                .andExpect(status().isBadRequest());
    }

    @Test
    void correctingAnUnknownAssignmentIs404() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);

        patchJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId + "/assignments/" + UUID.randomUUID(),
                        supervisorAToken, assignmentUpdateBody(null, "LIGHT", null))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    void correctingAnAssignmentOnAnUnknownShiftIs404() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);
        String assignmentId = addAssignment(shiftId, "MODERATE");

        patchJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + UUID.randomUUID() + "/assignments/" + assignmentId,
                        supervisorAToken, assignmentUpdateBody(null, "LIGHT", null))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    void workerIsForbiddenFromCorrectingAnAssignment() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);
        String assignmentId = addAssignment(shiftId, "MODERATE");
        String workerAToken = mintAccessToken(workerA.getUsername());

        patchJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId + "/assignments/" + assignmentId,
                        workerAToken, assignmentUpdateBody(null, "LIGHT", null))
                .andExpect(status().isForbidden());
    }

    // --- SCRUM-159/160-fix: remove an assignment ---

    @Test
    void supervisorRemovesAnAssignment() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);
        String assignmentId = addAssignment(shiftId, "MODERATE");

        deleteAuthenticated("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId
                        + "/assignments/" + assignmentId, supervisorAToken)
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId)
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignments.length()").value(0));

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.SHIFT_ASSIGNMENT_REMOVED))
                .anyMatch(e -> UUID.fromString(assignmentId).equals(e.getTargetId())
                        && supervisorA.getId().equals(e.getActorId()));
    }

    @Test
    void removingAnUnknownAssignmentIs404() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);

        deleteAuthenticated("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId
                        + "/assignments/" + UUID.randomUUID(), supervisorAToken)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    void removingAnAssignmentFromAnUnknownShiftIs404() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);
        String assignmentId = addAssignment(shiftId, "MODERATE");

        deleteAuthenticated("/api/v1/sites/" + siteA.getId() + "/shifts/" + UUID.randomUUID()
                        + "/assignments/" + assignmentId, supervisorAToken)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    // --- SCRUM-254: prevent worker double-booking across overlapping shifts ---

    @Test
    void addingAWorkerToAnOverlappingShiftAtTheSameSiteIsBadRequest() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        addAssignment(createShift(startsAt, endsAt), "LIGHT");

        String overlappingShiftId = createShift(startsAt.plus(1, ChronoUnit.HOURS), endsAt.plus(1, ChronoUnit.HOURS));

        postJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + overlappingShiftId + "/assignments",
                        supervisorAToken, assignmentBody(workerA.getId(), null, "LIGHT", null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Bad Request"));
    }

    @Test
    void addingAWorkerToAnOverlappingShiftAtAnotherSiteIsBadRequest() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        addAssignment(createShift(startsAt, endsAt), "LIGHT");

        memberships.save(new SiteMembership(workerA.getId(), siteB.getId()));
        String shiftAtSiteB = objectMapper.readTree(
                        postJson("/api/v1/sites/" + siteB.getId() + "/shifts", supervisorBToken,
                                        shiftBody(startsAt, endsAt, List.of()))
                                .andExpect(status().isCreated())
                                .andReturn().getResponse().getContentAsString())
                .get("id").asText();

        postJson("/api/v1/sites/" + siteB.getId() + "/shifts/" + shiftAtSiteB + "/assignments",
                        supervisorBToken, assignmentBody(workerA.getId(), null, "LIGHT", null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Bad Request"));
    }

    @Test
    void assigningTheSameWorkerToTheSameShiftTwiceIsBadRequest() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);
        addAssignment(shiftId, "LIGHT");

        postJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId + "/assignments",
                        supervisorAToken, assignmentBody(workerA.getId(), null, "MODERATE", null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Bad Request"));
    }

    @Test
    void creatingAShiftWithTheSameWorkerTwiceInTheSameBatchIsBadRequest() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);

        postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                        shiftBody(startsAt, endsAt, List.of(
                                assignmentBody(workerA.getId(), "Task 1", "LIGHT", null),
                                assignmentBody(workerA.getId(), "Task 2", "LIGHT", null))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Bad Request"));
    }

    @Test
    void creatingAShiftThatOverlapsAnExistingAssignmentIsBadRequest() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        addAssignment(createShift(startsAt, endsAt), "LIGHT");

        postJson("/api/v1/sites/" + siteA.getId() + "/shifts", supervisorAToken,
                        shiftBody(startsAt.plus(1, ChronoUnit.HOURS), endsAt.plus(1, ChronoUnit.HOURS),
                                List.of(assignmentBody(workerA.getId(), null, "LIGHT", null))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Bad Request"));
    }

    @Test
    void backToBackShiftsForTheSameWorkerAreNotAnOverlap() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        addAssignment(createShift(startsAt, endsAt), "LIGHT");

        String secondShiftId = createShift(endsAt, endsAt.plus(8, ChronoUnit.HOURS));

        postJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + secondShiftId + "/assignments",
                        supervisorAToken, assignmentBody(workerA.getId(), null, "LIGHT", null))
                .andExpect(status().isCreated());
    }

    @Test
    void workerIsForbiddenFromRemovingAnAssignment() throws Exception {
        Instant startsAt = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        Instant endsAt = startsAt.plus(8, ChronoUnit.HOURS);
        String shiftId = createShift(startsAt, endsAt);
        String assignmentId = addAssignment(shiftId, "MODERATE");
        String workerAToken = mintAccessToken(workerA.getUsername());

        deleteAuthenticated("/api/v1/sites/" + siteA.getId() + "/shifts/" + shiftId
                        + "/assignments/" + assignmentId, workerAToken)
                .andExpect(status().isForbidden());
    }
}
