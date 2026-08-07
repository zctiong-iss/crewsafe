package com.crewsafe.shift.api;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The worker's own shift (SCRUM-266).
 *
 * <p>{@link #neverLeaksAnotherWorkersAssignment()} is the one that matters. A shift carries every
 * worker on it, and this endpoint exists precisely because the supervisor's view — which returns
 * all of them — is the wrong answer for a worker. If that ever regressed, the screen would look
 * completely normal while showing one person somebody else's task.
 *
 * @author Justin Chua
 */
@AutoConfigureMockMvc
class MyShiftControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private ShiftRepository shifts;
    @Autowired private ShiftAssignmentRepository assignments;

    private Site site;
    private AppUser worker;
    private String workerToken;

    @BeforeEach
    void setUp() {
        site = sites.save(new Site("My shift " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));

        String username = "myshift-" + UUID.randomUUID();
        createCognitoUser(username);
        worker = users.save(new AppUser(username, subFor(username), "Shift Worker", Role.WORKER));
        memberships.save(new SiteMembership(worker.getId(), site.getId()));
        workerToken = mintAccessToken(username);
    }

    @Test
    void returnsTheShiftThatIsRunningNow() throws Exception {
        Shift running = shifts.save(new Shift(site.getId(),
                Instant.now().minusSeconds(3600), Instant.now().plusSeconds(3 * 3600)));
        assignments.save(new ShiftAssignment(running.getId(), worker.getId(),
                "Kerb laying, east verge", Intensity.HEAVY, 3));

        mockMvc.perform(authenticated())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shift.shiftId").value(running.getId().toString()))
                .andExpect(jsonPath("$.shift.siteId").value(site.getId().toString()))
                .andExpect(jsonPath("$.shift.assignment.taskName").value("Kerb laying, east verge"))
                .andExpect(jsonPath("$.shift.assignment.intensity").value("HEAVY"))
                .andExpect(jsonPath("$.shift.assignment.acclimatisationDay").value(3));
    }

    @Test
    void prefersTheRunningShiftOverALaterOne() throws Exception {
        Shift running = shifts.save(new Shift(site.getId(),
                Instant.now().minusSeconds(3600), Instant.now().plusSeconds(3600)));
        assignments.save(new ShiftAssignment(running.getId(), worker.getId(),
                "Happening now", Intensity.MODERATE, 1));

        Shift later = shifts.save(new Shift(site.getId(),
                Instant.now().plusSeconds(10 * 3600), Instant.now().plusSeconds(14 * 3600)));
        assignments.save(new ShiftAssignment(later.getId(), worker.getId(),
                "Tomorrow", Intensity.LIGHT, 2));

        mockMvc.perform(authenticated())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shift.assignment.taskName").value("Happening now"));
    }

    @Test
    void fallsBackToTheSoonestUpcomingShift() throws Exception {
        Shift soon = shifts.save(new Shift(site.getId(),
                Instant.now().plusSeconds(2 * 3600), Instant.now().plusSeconds(6 * 3600)));
        assignments.save(new ShiftAssignment(soon.getId(), worker.getId(),
                "Later today", Intensity.LIGHT, 1));

        Shift muchLater = shifts.save(new Shift(site.getId(),
                Instant.now().plusSeconds(30 * 3600), Instant.now().plusSeconds(34 * 3600)));
        assignments.save(new ShiftAssignment(muchLater.getId(), worker.getId(),
                "Next week", Intensity.LIGHT, 1));

        mockMvc.perform(authenticated())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shift.assignment.taskName").value("Later today"));
    }

    @Test
    void neverLeaksAnotherWorkersAssignment() throws Exception {
        Shift shared = shifts.save(new Shift(site.getId(),
                Instant.now().minusSeconds(3600), Instant.now().plusSeconds(3600)));
        assignments.save(new ShiftAssignment(shared.getId(), worker.getId(),
                "My own task", Intensity.MODERATE, 2));
        // A real second user: worker_id carries a foreign key, and a fabricated uuid would fail
        // the insert rather than exercise the leak this test is about.
        String otherName = "myshift-other-" + UUID.randomUUID();
        createCognitoUser(otherName);
        AppUser other = users.save(new AppUser(
                otherName, subFor(otherName), "Other Worker", Role.WORKER));
        memberships.save(new SiteMembership(other.getId(), site.getId()));
        assignments.save(new ShiftAssignment(shared.getId(), other.getId(),
                "Somebody else's task", Intensity.HEAVY, 7));

        // One assignment object, and it is the caller's. The supervisor's view returns every
        // assignment on the shift by design; that is exactly why this endpoint is separate.
        mockMvc.perform(authenticated())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shift.assignment.taskName").value("My own task"))
                .andExpect(jsonPath("$.shift.assignment.intensity").value("MODERATE"))
                .andExpect(jsonPath("$.shift.assignments").doesNotExist());
    }

    @Test
    void ignoresAShiftThatHasAlreadyEnded() throws Exception {
        Shift finished = shifts.save(new Shift(site.getId(),
                Instant.now().minusSeconds(6 * 3600), Instant.now().minusSeconds(2 * 3600)));
        assignments.save(new ShiftAssignment(finished.getId(), worker.getId(),
                "Yesterday", Intensity.HEAVY, 1));

        mockMvc.perform(authenticated())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shift").doesNotExist());
    }

    @Test
    void answersWithANullShiftRatherThanA404WhenNothingIsScheduled() throws Exception {
        // "You have no shift" is a legitimate answer to a question the caller was entitled to
        // ask. A 404 would say the endpoint is missing, which is what it actually was until now.
        mockMvc.perform(authenticated())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shift").doesNotExist());
    }

    @Test
    void requiresAuthentication() throws Exception {
        mockMvc.perform(get("/api/v1/shifts/me"))
                .andExpect(status().isUnauthorized());
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder authenticated() {
        return get("/api/v1/shifts/me").header("Authorization", "Bearer " + workerToken);
    }
}
