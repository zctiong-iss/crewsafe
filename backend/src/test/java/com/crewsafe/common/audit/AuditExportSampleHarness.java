package com.crewsafe.common.audit;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Not an assertion test — a sample generator. Boots the real application against real
 * Postgres and a real Cognito emulator, drives the real endpoints to produce a realistic
 * site history, then writes the actual export to {@code target/audit-export-sample/} so a
 * human can open the file rather than read assertions about it.
 *
 * <p>Run explicitly: {@code ./mvnw -Dtest=AuditExportSampleHarness test}.
 */
@AutoConfigureMockMvc
class AuditExportSampleHarness extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;

    private AppUser user(String displayName, Role role) {
        String username = "sample-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), displayName, role));
    }

    @Test
    void writeASampleExportToDisk() throws Exception {
        Site tuas = sites.save(new Site("Tuas Yard B",
                new BigDecimal("1.294000"), new BigDecimal("103.636000")));
        Site jurong = sites.save(new Site("Jurong Site 12",
                new BigDecimal("1.333000"), new BigDecimal("103.742000")));

        AppUser manager = user("Wei Ling (Safety Manager)", Role.SAFETY_MANAGER);
        AppUser priya = user("Priya Raman", Role.SUPERVISOR);
        AppUser hafiz = user("Hafiz Rahman", Role.SUPERVISOR);
        AppUser worker = user("Meng Hui", Role.WORKER);
        AppUser otherSiteSupervisor = user("Someone At Jurong", Role.SUPERVISOR);

        // Two supervisors on the one site, to show the model allows it.
        memberships.save(new SiteMembership(manager.getId(), tuas.getId()));
        memberships.save(new SiteMembership(priya.getId(), tuas.getId()));
        memberships.save(new SiteMembership(hafiz.getId(), tuas.getId()));
        memberships.save(new SiteMembership(worker.getId(), tuas.getId()));
        memberships.save(new SiteMembership(otherSiteSupervisor.getId(), jurong.getId()));

        String priyaToken = mintAccessToken(priya.getUsername());
        String hafizToken = mintAccessToken(hafiz.getUsername());
        String managerToken = mintAccessToken(manager.getUsername());
        String jurongToken = mintAccessToken(otherSiteSupervisor.getUsername());

        // A day at Tuas: a shift planned and staffed, a second one corrected then called off.
        String morning = createShift(tuas.getId(), priyaToken, 1);
        addAssignment(tuas.getId(), morning, priyaToken, worker.getId());

        String afternoon = createShift(tuas.getId(), hafizToken, 10);
        cancelShift(tuas.getId(), afternoon, hafizToken, "Lightning risk, crew stood down");

        // Noise that must NOT appear in the Tuas export: another site's whole history.
        String atJurong = createShift(jurong.getId(), jurongToken, 2);
        cancelShift(jurong.getId(), atJurong, jurongToken, "Jurong-only event");

        // And a cross-site attempt, which is itself recorded against the site attempted.
        mockMvc.perform(get("/api/v1/sites/" + tuas.getId() + "/shifts")
                .header("Authorization", "Bearer " + jurongToken));

        byte[] body = mockMvc.perform(get("/api/v1/sites/" + tuas.getId() + "/audit/export")
                        .header("Authorization", "Bearer " + managerToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();

        Path dir = Path.of("target", "audit-export-sample");
        Files.createDirectories(dir);
        Files.write(dir.resolve("audit-export.csv"), body);
        Files.writeString(dir.resolve("context.txt"), """
                Tuas Yard B site id : %s
                Jurong Site 12 id   : %s   <- must NOT appear in the export
                Cancelled at Jurong : %s   <- must NOT appear in the export
                Morning shift (Tuas): %s
                Afternoon shift     : %s
                """.formatted(tuas.getId(), jurong.getId(), atJurong, morning, afternoon));
    }

    private String createShift(UUID siteId, String token, int hoursFromNow) throws Exception {
        Instant startsAt = Instant.now().plus(hoursFromNow, ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("startsAt", startsAt.toString());
        body.put("endsAt", startsAt.plus(8, ChronoUnit.HOURS).toString());
        body.put("assignments", List.of());

        return objectMapper.readTree(
                        mockMvc.perform(post("/api/v1/sites/" + siteId + "/shifts")
                                        .header("Authorization", "Bearer " + token)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(objectMapper.writeValueAsString(body)))
                                .andExpect(status().isCreated())
                                .andReturn().getResponse().getContentAsString())
                .get("id").asText();
    }

    private void addAssignment(UUID siteId, String shiftId, String token, UUID workerId) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("workerId", workerId.toString());
        body.put("taskName", "Rebar fixing, bay 3");
        body.put("intensity", "HEAVY");
        body.put("acclimatisationDay", 2);

        mockMvc.perform(post("/api/v1/sites/" + siteId + "/shifts/" + shiftId + "/assignments")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated());
    }

    private void cancelShift(UUID siteId, String shiftId, String token, String reason) throws Exception {
        mockMvc.perform(post("/api/v1/sites/" + siteId + "/shifts/" + shiftId + "/cancel")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("reason", reason))))
                .andExpect(status().isOk());
    }
}
