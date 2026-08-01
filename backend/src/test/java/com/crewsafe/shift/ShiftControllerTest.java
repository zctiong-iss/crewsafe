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
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * SCRUM-160: create/list/read a shift and add an assignment to one, plus the site
 * scoping and audit behaviour called for in the implementation plan.
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

    private ResultActions postJson(String url, String token, Object body) throws Exception {
        return mockMvc.perform(post(url)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
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
                .andExpect(status().isNotFound());
    }

    @Test
    void addingAnAssignmentToAnUnknownShiftIs404() throws Exception {
        postJson("/api/v1/sites/" + siteA.getId() + "/shifts/" + UUID.randomUUID() + "/assignments",
                        supervisorAToken, assignmentBody(workerA.getId(), null, "LIGHT", null))
                .andExpect(status().isNotFound());
    }
}
