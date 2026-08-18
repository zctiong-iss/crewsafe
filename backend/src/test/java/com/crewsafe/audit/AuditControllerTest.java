package com.crewsafe.audit;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.common.audit.AuditEvent;
import com.crewsafe.common.audit.AuditEventRepository;
import com.crewsafe.common.audit.AuditEventType;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The SCRUM-435 inspector audit trail: a site-scoped timeline and its CSV export.
 *
 * <p>The cases that carry the weight are the scoping ones. {@code audit_event} has no
 * {@code site_id}, so a row reaches a site only by resolving its target — a bug there either
 * leaks another site's history into this export or drops rows that belong in it, and both are
 * compliance failures, not cosmetic ones. The CSV case pins RFC-4180 quoting, because a
 * free-text {@code detail} with a comma in it would otherwise split into phantom columns.
 *
 * @author Tang Chee Seng
 */
@AutoConfigureMockMvc
class AuditControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private SiteRepository sites;
    @Autowired private ShiftRepository shifts;
    @Autowired private AuditEventRepository auditEvents;

    private Site site;
    private AppUser manager;
    private String managerToken;
    private String supervisorToken;
    private Instant from;
    private Instant to;

    @BeforeEach
    void setUp() {
        site = sites.save(new Site("Audit " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
        manager = user(Role.SAFETY_MANAGER);
        managerToken = mintAccessToken(manager.getUsername());
        supervisorToken = mintAccessToken(user(Role.SUPERVISOR).getUsername());

        from = Instant.now().minus(1, ChronoUnit.HOURS);
        to = Instant.now().plus(1, ChronoUnit.HOURS);
    }

    @Test
    void managerSeesTheSiteTimelineWithResolvedActorEventAndTarget() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(), Instant.now(), Instant.now().plusSeconds(3600)));
        String correlationId = "req-" + UUID.randomUUID();
        auditEvents.save(new AuditEvent(manager.getId(), AuditEventType.SHIFT_CREATED,
                "SHIFT", shift.getId(), correlationId, "Created shift, night crew"));

        page(managerToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.siteId").value(site.getId().toString()))
                .andExpect(jsonPath("$.totalEntries").value(1))
                .andExpect(jsonPath("$.entries.length()").value(1))
                // actor resolved to a name, event to a label, target and trace all present
                .andExpect(jsonPath("$.entries[0].actorName").value(manager.getDisplayName()))
                .andExpect(jsonPath("$.entries[0].eventLabel").value("Shift created"))
                .andExpect(jsonPath("$.entries[0].eventType").value("SHIFT_CREATED"))
                .andExpect(jsonPath("$.entries[0].targetType").value("SHIFT"))
                .andExpect(jsonPath("$.entries[0].targetId").value(shift.getId().toString()))
                .andExpect(jsonPath("$.entries[0].correlationId").value(correlationId));
    }

    @Test
    void aSystemEventWithNoActorReadsAsUnauthenticated() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(), Instant.now(), Instant.now().plusSeconds(3600)));
        // A scheduler-driven activation has no authenticated actor.
        auditEvents.save(new AuditEvent(null, AuditEventType.SHIFT_ACTIVATED,
                "SHIFT", shift.getId(), "sys-" + UUID.randomUUID(), "Auto-activated"));

        page(managerToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[0].actorName").value("system / unauthenticated"));
    }

    @Test
    void anotherSitesRowsNeverAppear() throws Exception {
        Site otherSite = sites.save(new Site("Other " + UUID.randomUUID(),
                new BigDecimal("1.310000"), new BigDecimal("103.810000")));
        Shift here = shifts.save(new Shift(site.getId(), Instant.now(), Instant.now().plusSeconds(3600)));
        Shift there = shifts.save(new Shift(otherSite.getId(), Instant.now(), Instant.now().plusSeconds(3600)));
        auditEvents.save(new AuditEvent(manager.getId(), AuditEventType.SHIFT_CREATED,
                "SHIFT", here.getId(), "req-" + UUID.randomUUID(), "ours"));
        auditEvents.save(new AuditEvent(manager.getId(), AuditEventType.SHIFT_CREATED,
                "SHIFT", there.getId(), "req-" + UUID.randomUUID(), "theirs"));

        // Only the event whose target resolves to this site is in scope.
        page(managerToken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalEntries").value(1))
                .andExpect(jsonPath("$.entries[0].targetId").value(here.getId().toString()));
    }

    @Test
    void csvExportQuotesFieldsThatContainCommas() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(), Instant.now(), Instant.now().plusSeconds(3600)));
        auditEvents.save(new AuditEvent(manager.getId(), AuditEventType.SHIFT_CREATED,
                "SHIFT", shift.getId(), "req-" + UUID.randomUUID(), "Created shift, night crew"));

        String csv = exportCsv(managerToken)
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition",
                        org.hamcrest.Matchers.containsString("attachment; filename=")))
                .andReturn().getResponse().getContentAsString();

        // Header present, and the comma-bearing detail is wrapped in quotes rather than split.
        assertThat(csv)
                .contains("occurred_at,actor,event,event_type")
                .contains("\"Created shift, night crew\"")
                .contains(manager.getDisplayName());
    }

    @Test
    void csvExportNeutralisesSpreadsheetFormulaInjection() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(), Instant.now(), Instant.now().plusSeconds(3600)));
        // A crafted detail that a spreadsheet would execute as a formula on open.
        auditEvents.save(new AuditEvent(manager.getId(), AuditEventType.SHIFT_CREATED,
                "SHIFT", shift.getId(), "req-" + UUID.randomUUID(), "=1+1"));

        String csv = exportCsv(managerToken)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // The leading '=' is defused with an apostrophe, so no cell evaluates the formula.
        assertThat(csv).contains("'=1+1").doesNotContain(",=1+1");
    }

    /**
     * The trail is DB-enforced insert-only (V5's trigger), but that protects the table, not a
     * file already handed to an inspector. The trailer's printed SHA-256 lets them verify the
     * copy they hold is what the system produced, with the exact command the trailer itself
     * names.
     */
    @Test
    void csvExportCarriesAVerifiableChecksumOfTheDataSection() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(), Instant.now(), Instant.now().plusSeconds(3600)));
        auditEvents.save(new AuditEvent(manager.getId(), AuditEventType.SHIFT_CREATED,
                "SHIFT", shift.getId(), "req-" + UUID.randomUUID(), "Created shift, night crew"));

        String csv = exportCsv(managerToken)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String printed = csv.lines()
                .filter(line -> line.startsWith("# sha256,"))
                .map(line -> line.split(",")[1])
                .findFirst().orElseThrow();

        assertThat(printed).isEqualTo(sha256(dataSection(csv)));
    }

    /** Tampering with a data row must be visible: it changes the section the checksum covers. */
    @Test
    void tamperingWithADataRowBreaksTheChecksum() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(), Instant.now(), Instant.now().plusSeconds(3600)));
        auditEvents.save(new AuditEvent(manager.getId(), AuditEventType.SHIFT_CREATED,
                "SHIFT", shift.getId(), "req-" + UUID.randomUUID(), "Created shift, night crew"));

        String csv = exportCsv(managerToken)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String printed = csv.lines()
                .filter(line -> line.startsWith("# sha256,"))
                .map(line -> line.split(",")[1])
                .findFirst().orElseThrow();
        String tampered = dataSection(csv).replace("SHIFT_CREATED", "SHIFT_DELETED");

        assertThat(sha256(tampered)).isNotEqualTo(printed);
    }

    /** Every line — data and trailer alike — stays the header's width, so the file still opens
     *  in a standard CSV viewer instead of the header being read as one column wide. */
    @Test
    void everyLineInTheExportHasTheSameColumnCount() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(), Instant.now(), Instant.now().plusSeconds(3600)));
        auditEvents.save(new AuditEvent(manager.getId(), AuditEventType.SHIFT_CREATED,
                "SHIFT", shift.getId(), "req-" + UUID.randomUUID(), "Created shift, night crew"));

        String csv = exportCsv(managerToken)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        long expectedColumns = csv.lines().findFirst().orElseThrow().chars().filter(c -> c == ',').count() + 1;
        assertThat(csv.lines())
                .allSatisfy(line -> assertThat(countFields(line))
                        .describedAs("column count of: %s", line)
                        .isEqualTo(expectedColumns));
    }

    /** Pulling the whole trail is itself worth a trace: the export is targeted at the SITE. */
    @Test
    void exportingIsRecordedToTheAuditTrail() throws Exception {
        Shift shift = shifts.save(new Shift(site.getId(), Instant.now(), Instant.now().plusSeconds(3600)));
        auditEvents.save(new AuditEvent(manager.getId(), AuditEventType.SHIFT_CREATED,
                "SHIFT", shift.getId(), "req-" + UUID.randomUUID(), "Created shift, night crew"));

        exportCsv(managerToken).andExpect(status().isOk());

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.AUDIT_EXPORTED))
                .anyMatch(e -> site.getId().equals(e.getTargetId()) && manager.getId().equals(e.getActorId()));
    }

    @Test
    void aSupervisorCannotReadTheAuditTrail() throws Exception {
        // The trail records what supervisors did — reading it is a manager/oversight surface.
        page(supervisorToken).andExpect(status().isForbidden());
    }

    @Test
    void aSiteTheManagerDoesNotBelongToIsForbidden() throws Exception {
        Site otherSite = sites.save(new Site("Other " + UUID.randomUUID(),
                new BigDecimal("1.310000"), new BigDecimal("103.810000")));
        mockMvc.perform(get("/api/v1/sites/" + otherSite.getId() + "/audit")
                        .param("from", from.toString()).param("to", to.toString())
                        .header("Authorization", "Bearer " + managerToken))
                .andExpect(status().isForbidden());
    }

    /* --------------------------------- helpers --------------------------------- */

    private AppUser user(Role role) {
        String username = "audit-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), "Audit " + role, role));
        memberships.save(new SiteMembership(created.getId(), site.getId()));
        return created;
    }

    private ResultActions page(String token) throws Exception {
        return mockMvc.perform(get("/api/v1/sites/" + site.getId() + "/audit")
                .param("from", from.toString()).param("to", to.toString())
                .header("Authorization", "Bearer " + token));
    }

    /**
     * Drives the streaming CSV endpoint. A {@code StreamingResponseBody} completes on a second,
     * asynchronous dispatch, so the body is empty until {@code asyncDispatch} runs — reading it
     * off the first result is the trap that makes these tests pass by luck and fail in isolation.
     */
    private ResultActions exportCsv(String token) throws Exception {
        MvcResult started = mockMvc.perform(get("/api/v1/sites/" + site.getId() + "/audit/export.csv")
                        .param("from", from.toString()).param("to", to.toString())
                        .header("Authorization", "Bearer " + token))
                .andExpect(request().asyncStarted())
                .andReturn();
        return mockMvc.perform(asyncDispatch(started));
    }

    /** Everything above the '#' trailer — the bytes the printed SHA-256 covers. */
    private static String dataSection(String csv) {
        return csv.lines()
                .takeWhile(line -> !line.startsWith("#"))
                .reduce("", (acc, line) -> acc + line + "\r\n");
    }

    private static String sha256(String content) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(content.getBytes(StandardCharsets.UTF_8)));
    }

    /** Counts CSV fields honouring quoting, so a quoted comma is not miscounted as a separator. */
    private static long countFields(String line) {
        long fields = 1;
        boolean inQuotes = false;
        for (char c : line.toCharArray()) {
            if (c == '"') {
                inQuotes = !inQuotes;
            } else if (c == ',' && !inQuotes) {
                fields++;
            }
        }
        return fields;
    }
}
