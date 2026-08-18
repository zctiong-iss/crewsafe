package com.crewsafe.shift.api;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * A SAFETY_MANAGER may read a site's shifts but may not change them (SCRUM-TBD-92).
 *
 * <h2>Why this test exists rather than a UI change alone</h2>
 *
 * The requirement was "prevent the safety manager from accessing edit access to the shift",
 * and the obvious implementation — remove the Plan a shift button — does not do that. Every
 * mutating endpoint on {@link ShiftController} carried
 * {@code hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN')}, so a manager holding a token
 * could still create, correct, cancel and delete shifts with no client at all. Hiding a
 * control is a presentation decision; this is the access decision.
 *
 * <p>Both directions are asserted deliberately. The 403s prove the write path closed; the
 * 200s prove the read path did not close with it, which is the failure this change could
 * plausibly introduce. A recommendation names only its {@code shiftId}, so the Oversight
 * screen resolves the shift window a plan applies to by reading the shift — a role clause
 * added to the GETs would break oversight while looking like an improvement.
 *
 * <p>The manager here is a MEMBER of the site. Denial therefore has to come from the role
 * gate rather than from {@code @siteAccess.canAccess}, which is the distinction
 * {@code SiteAuthorizationTest} does not cover: its manager is denied for being on the wrong
 * site entirely.
 */
@AutoConfigureMockMvc
class ShiftWriteAuthorizationTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private ShiftRepository shifts;

    private Site site;
    private Shift shift;
    private String managerToken;
    private String supervisorToken;

    private AppUser user(Role role) {
        String username = "shiftauthz-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), "Shift Authz " + role, role));
    }

    private String tokenFor(AppUser user) {
        return mintAccessToken(user.getUsername());
    }

    @BeforeEach
    void setUp() {
        site = sites.save(new Site("Shift Authz Site " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));

        AppUser manager = user(Role.SAFETY_MANAGER);
        AppUser supervisor = user(Role.SUPERVISOR);
        // Both are members: the point is that membership alone no longer buys a write.
        memberships.save(new SiteMembership(manager.getId(), site.getId()));
        memberships.save(new SiteMembership(supervisor.getId(), site.getId()));

        managerToken = tokenFor(manager);
        supervisorToken = tokenFor(supervisor);

        shift = shifts.save(new Shift(site.getId(),
                Instant.now().plus(Duration.ofHours(1)),
                Instant.now().plus(Duration.ofHours(9))));
    }

    private String base() {
        return "/api/v1/sites/" + site.getId() + "/shifts";
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }

    /* ── The write path is closed ──────────────────────────────────────────────────────── */

    @Test
    void safetyManagerCannotCreateAShift() throws Exception {
        String body = """
                {"startsAt":"%s","endsAt":"%s","assignments":[]}
                """.formatted(Instant.now().plus(Duration.ofHours(2)),
                Instant.now().plus(Duration.ofHours(10)));

        mockMvc.perform(post(base())
                        .header("Authorization", bearer(managerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden());
    }

    @Test
    void safetyManagerCannotCorrectAShift() throws Exception {
        /*
         * Both fields supplied because ShiftUpdateRequest marks each @NotNull, and bean
         * validation runs during argument resolution — BEFORE @PreAuthorize is reached. An
         * incomplete body would answer 400 and this test would pass without ever exercising
         * the role gate it exists for.
         */
        String body = """
                {"startsAt":"%s","endsAt":"%s"}
                """.formatted(Instant.now().plus(Duration.ofHours(3)),
                Instant.now().plus(Duration.ofHours(11)));

        mockMvc.perform(patch(base() + "/" + shift.getId())
                        .header("Authorization", bearer(managerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden());
    }

    @Test
    void safetyManagerCannotDeleteAShift() throws Exception {
        mockMvc.perform(delete(base() + "/" + shift.getId())
                        .header("Authorization", bearer(managerToken)))
                .andExpect(status().isForbidden());
    }

    @Test
    void safetyManagerCannotCancelAShift() throws Exception {
        // A non-blank reason: CancelShiftRequest marks it @NotBlank, and validation precedes
        // the role gate.
        mockMvc.perform(post(base() + "/" + shift.getId() + "/cancel")
                        .header("Authorization", bearer(managerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"weather\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void safetyManagerCannotStaffAShift() throws Exception {
        mockMvc.perform(post(base() + "/" + shift.getId() + "/assignments")
                        .header("Authorization", bearer(managerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"workerId\":\"%s\",\"intensity\":\"HEAVY\"}".formatted(UUID.randomUUID())))
                .andExpect(status().isForbidden());
    }

    @Test
    void safetyManagerCannotChangeAnAssignment() throws Exception {
        mockMvc.perform(patch(base() + "/" + shift.getId() + "/assignments/" + UUID.randomUUID())
                        .header("Authorization", bearer(managerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"intensity\":\"LIGHT\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void safetyManagerCannotRemoveAnAssignment() throws Exception {
        mockMvc.perform(delete(base() + "/" + shift.getId() + "/assignments/" + UUID.randomUUID())
                        .header("Authorization", bearer(managerToken)))
                .andExpect(status().isForbidden());
    }

    /* ── The read path is not ──────────────────────────────────────────────────────────── */

    @Test
    void safetyManagerCanStillListShifts() throws Exception {
        // Oversight resolves each plan's shift window from here. If this closes, the screen
        // renders plans with no window and the security change has broken the feature it
        // was made for.
        mockMvc.perform(get(base()).header("Authorization", bearer(managerToken)))
                .andExpect(status().isOk());
    }

    @Test
    void safetyManagerCanStillReadASingleShift() throws Exception {
        mockMvc.perform(get(base() + "/" + shift.getId())
                        .header("Authorization", bearer(managerToken)))
                .andExpect(status().isOk());
    }

    /* ── The supervisor is unaffected ──────────────────────────────────────────────────── */

    @Test
    void supervisorCanStillCancelAShift() throws Exception {
        /*
         * The guard against over-tightening: this change must remove one role, not the group.
         *
         * Asserted as "not 403" rather than as a specific success code, because what happens
         * after authorization passes is this test's business only insofar as it is not a
         * refusal — a cancel may legitimately answer 200, 404 or 409 depending on shift state,
         * and pinning one of those would make an authorization test fail for a domain reason.
         */
        mockMvc.perform(post(base() + "/" + shift.getId() + "/cancel")
                        .header("Authorization", bearer(supervisorToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"weather\"}"))
                .andExpect(result ->
                        assertThat(result.getResponse().getStatus()).isNotEqualTo(403));
    }
}
