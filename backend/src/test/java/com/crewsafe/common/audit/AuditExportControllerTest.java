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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * SCRUM-452 (US-15): a Safety Manager exports the site's audit timeline as CSV.
 *
 * <p>The audit rows under test are written by driving the real shift endpoints rather than
 * by inserting {@code AuditEvent} rows directly. That matters most for
 * {@link #anotherSitesAuditRowsNeverAppearInThisSitesExport()}: {@code audit_event} has no
 * {@code site_id} column, so site attribution is a read-time join through
 * {@code target_type}/{@code target_id}, and a hand-inserted row would prove the query runs
 * without proving it attributes what the write paths actually produce.
 *
 * @author Abu Bakar
 */
@AutoConfigureMockMvc
class AuditExportControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private AuditEventRepository auditEvents;

    private static final int PREAMBLE_LINES = 8;

    private Site siteA;
    private Site siteB;
    private AppUser managerA;
    private AppUser supervisorA;
    private String managerAToken;
    private String supervisorAToken;
    private String supervisorBToken;
    private String managerBToken;

    private AppUser user(Role role) {
        String username = "audit-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), "Audit Test " + role, role));
    }

    private Site site(String label) {
        return sites.save(new Site("Audit " + label + " " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
    }

    @BeforeEach
    void setUp() {
        siteA = site("Site A");
        siteB = site("Site B");

        managerA = user(Role.SAFETY_MANAGER);
        supervisorA = user(Role.SUPERVISOR);
        AppUser supervisorB = user(Role.SUPERVISOR);
        AppUser managerB = user(Role.SAFETY_MANAGER);

        memberships.save(new SiteMembership(managerA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(supervisorA.getId(), siteA.getId()));
        memberships.save(new SiteMembership(supervisorB.getId(), siteB.getId()));
        memberships.save(new SiteMembership(managerB.getId(), siteB.getId()));

        managerAToken = mintAccessToken(managerA.getUsername());
        supervisorAToken = mintAccessToken(supervisorA.getUsername());
        supervisorBToken = mintAccessToken(supervisorB.getUsername());
        managerBToken = mintAccessToken(managerB.getUsername());
    }

    // --- helpers that produce real audit rows ---

    private String createShift(UUID siteId, String token) throws Exception {
        Instant startsAt = Instant.now().plus(1, ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS);
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

    private void cancelShift(UUID siteId, String shiftId, String token, String reason) throws Exception {
        mockMvc.perform(post("/api/v1/sites/" + siteId + "/shifts/" + shiftId + "/cancel")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("reason", reason))))
                .andExpect(status().isOk());
    }

    private String export(UUID siteId, String token) throws Exception {
        return mockMvc.perform(get("/api/v1/sites/" + siteId + "/audit/export")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    /** Everything below the fixed-length preamble — the bytes the printed digest covers. */
    private static String csvSectionOf(String body) {
        int index = 0;
        for (int i = 0; i < PREAMBLE_LINES; i++) {
            index = body.indexOf("\r\n", index) + 2;
        }
        return body.substring(index);
    }

    private static String sha256(String content) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(content.getBytes(StandardCharsets.UTF_8)));
    }

    // --- the acceptance criteria ---

    @Test
    void exportCarriesTraceIdsActorsDecisionsAndRules() throws Exception {
        String shiftId = createShift(siteA.getId(), supervisorAToken);

        String body = export(siteA.getId(), managerAToken);
        String header = csvSectionOf(body).lines().findFirst().orElseThrow();

        assertThat(header).isEqualTo("event_id,occurred_at,correlation_id,actor_id,actor_name,"
                + "event_type,target_type,target_id,detail");

        assertThat(body)
                .contains("SHIFT_CREATED")                    // the decision
                .contains(supervisorA.getId().toString())     // the actor, by id
                .contains("Audit Test SUPERVISOR")            // the actor, readably
                .contains(shiftId)                            // what it was done to
                .contains("Created shift for site " + siteA.getId()); // the rule, in words

        // The trace id: every row carries the correlation id its request ran under.
        String firstDataRow = csvSectionOf(body).lines().skip(1).findFirst().orElseThrow();
        String correlationId = firstDataRow.split(",")[2];
        assertThat(UUID.fromString(correlationId)).isNotNull();
    }

    /**
     * The reason site scoping exists. Site B's rows are written by the same write paths as
     * site A's and are indistinguishable in {@code audit_event} itself — only the join
     * through {@code target_id} tells them apart.
     */
    @Test
    void anotherSitesAuditRowsNeverAppearInThisSitesExport() throws Exception {
        String shiftAtA = createShift(siteA.getId(), supervisorAToken);
        String shiftAtB = createShift(siteB.getId(), supervisorBToken);
        cancelShift(siteB.getId(), shiftAtB, supervisorBToken, "Site B stood down");

        String body = export(siteA.getId(), managerAToken);

        assertThat(body)
                .contains(shiftAtA)
                .doesNotContain(shiftAtB)
                .doesNotContain(siteB.getId().toString())
                .doesNotContain("Site B stood down");
    }

    @Test
    void eachSiteSeesOnlyItsOwnRows() throws Exception {
        String shiftAtA = createShift(siteA.getId(), supervisorAToken);
        String shiftAtB = createShift(siteB.getId(), supervisorBToken);

        assertThat(export(siteB.getId(), managerBToken))
                .contains(shiftAtB)
                .doesNotContain(shiftAtA);
    }

    /**
     * A null actor is the codebase's convention for a scheduler-driven event. Blanking it
     * would read as missing data rather than as the finding it is, so it renders as SYSTEM.
     */
    @Test
    void systemTriggeredRowsNameSystemAsTheActor() throws Exception {
        auditEvents.save(new AuditEvent(null, AuditEventType.SHIFT_ACTIVATED, "SITE",
                siteA.getId(), UUID.randomUUID().toString(), "Shift auto-activated for site " + siteA.getId()));

        // Empty actor_id, then SYSTEM: the id column stays blank because there genuinely
        // was no actor, and the name column says so rather than leaving the row ambiguous.
        assertThat(export(siteA.getId(), managerAToken)).contains(",,SYSTEM,SHIFT_ACTIVATED");
    }

    // --- tamper-evidence ---

    @Test
    void printedChecksumMatchesTheCsvSectionItClaimsToCover() throws Exception {
        createShift(siteA.getId(), supervisorAToken);

        String body = export(siteA.getId(), managerAToken);

        String printed = body.lines()
                .filter(line -> line.startsWith("# sha256: "))
                .findFirst().orElseThrow()
                .replace("# sha256: ", "")
                .split(" ")[0];

        assertThat(printed).isEqualTo(sha256(csvSectionOf(body)));
    }

    /**
     * Header and body are taken from the <em>same</em> response on purpose. Two consecutive
     * exports do not agree, and should not: each export records an {@code AUDIT_EXPORTED}
     * row for the site it exported, so the next one legitimately has one row more. The
     * invariant is that a given file agrees with the header it arrived under.
     */
    @Test
    void checksumHeaderMatchesTheOnePrintedInTheSameFile() throws Exception {
        createShift(siteA.getId(), supervisorAToken);

        var response = mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/audit/export")
                        .header("Authorization", "Bearer " + managerAToken))
                .andExpect(status().isOk())
                .andExpect(header().exists(AuditController.CHECKSUM_HEADER))
                .andReturn().getResponse();

        String digest = response.getHeader(AuditController.CHECKSUM_HEADER);

        assertThat(response.getContentAsString())
                .contains("# sha256: " + digest)
                .satisfies(body -> assertThat(sha256(csvSectionOf(body))).isEqualTo(digest));
    }

    /** An altered file no longer matches the digest it carries — the point of the exercise. */
    @Test
    void tamperingWithARowBreaksTheChecksum() throws Exception {
        createShift(siteA.getId(), supervisorAToken);
        String body = export(siteA.getId(), managerAToken);

        String tampered = csvSectionOf(body).replace("SHIFT_CREATED", "SHIFT_DELETED");
        String printed = body.lines()
                .filter(line -> line.startsWith("# sha256: "))
                .findFirst().orElseThrow()
                .replace("# sha256: ", "")
                .split(" ")[0];

        assertThat(sha256(tampered)).isNotEqualTo(printed);
    }

    // --- CSV correctness ---

    /**
     * A cancellation reason is operator free text that lands in {@code detail}. One
     * containing a comma and a quote must not shift the columns of the row it sits in.
     */
    @Test
    void detailContainingCommasAndQuotesStaysInOneField() throws Exception {
        String shiftId = createShift(siteA.getId(), supervisorAToken);
        cancelShift(siteA.getId(), shiftId, supervisorAToken, "He said \"stop, now\", so we did");

        String body = export(siteA.getId(), managerAToken);

        assertThat(body).contains("\"Cancelled shift for site " + siteA.getId()
                + " - Reason: He said \"\"stop, now\"\", so we did\"");

        long cancelRows = csvSectionOf(body).lines()
                .filter(line -> line.contains("SHIFT_CANCELLED"))
                .count();
        assertThat(cancelRows).isEqualTo(1);
    }

    @Test
    void exportIsDeliveredAsACsvAttachment() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/audit/export")
                        .header("Authorization", "Bearer " + managerAToken))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "text/csv;charset=UTF-8"))
                .andExpect(header().string("Content-Disposition",
                        org.hamcrest.Matchers.containsString("attachment")));
    }

    @Test
    void preambleNamesTheSiteAndTheRowCount() throws Exception {
        createShift(siteA.getId(), supervisorAToken);

        String body = export(siteA.getId(), managerAToken);

        assertThat(body)
                .startsWith("# CrewSafe SG - audit timeline export\r\n")
                .contains("# site_id: " + siteA.getId())
                .contains("# site_name: " + siteA.getName());

        long dataRows = csvSectionOf(body).lines().skip(1).count();
        assertThat(body).contains("# row_count: " + dataRows);
    }

    // --- range filtering ---

    @Test
    void rowsOutsideTheRequestedRangeAreExcluded() throws Exception {
        createShift(siteA.getId(), supervisorAToken);
        Instant future = Instant.now().plus(1, ChronoUnit.DAYS);

        String body = mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/audit/export")
                        .param("from", future.toString())
                        .param("to", future.plus(1, ChronoUnit.DAYS).toString())
                        .header("Authorization", "Bearer " + managerAToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains("# row_count: 0");
        assertThat(csvSectionOf(body).lines().skip(1).count()).isZero();
    }

    @Test
    void anInvertedRangeIsBadRequest() throws Exception {
        Instant now = Instant.now();

        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/audit/export")
                        .param("from", now.toString())
                        .param("to", now.minus(1, ChronoUnit.HOURS).toString())
                        .header("Authorization", "Bearer " + managerAToken))
                .andExpect(status().isBadRequest());
    }

    // --- access control ---

    /** Bulk-reading the whole trail is above a supervisor's pay grade, even at their own site. */
    @Test
    void supervisorIsForbiddenFromExportingEvenAtTheirOwnSite() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/audit/export")
                        .header("Authorization", "Bearer " + supervisorAToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void safetyManagerFromAnotherSiteIsForbidden() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/audit/export")
                        .header("Authorization", "Bearer " + managerBToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void anUnauthenticatedExportIsRejected() throws Exception {
        mockMvc.perform(get("/api/v1/sites/" + siteA.getId() + "/audit/export"))
                .andExpect(status().isUnauthorized());
    }

    // --- the export is itself an audited event ---

    @Test
    void exportingIsRecordedToTheAuditTrail() throws Exception {
        export(siteA.getId(), managerAToken);

        assertThat(auditEvents.findByEventTypeOrderByOccurredAtDesc(AuditEventType.AUDIT_EXPORTED))
                .anyMatch(e -> siteA.getId().equals(e.getTargetId())
                        && managerA.getId().equals(e.getActorId()));
    }

    /** And, being a SITE-targeted row for this site, it shows up in the next export. */
    @Test
    void aPreviousExportAppearsInTheNextOne() throws Exception {
        export(siteA.getId(), managerAToken);

        assertThat(export(siteA.getId(), managerAToken)).contains(AuditEventType.AUDIT_EXPORTED);
    }
}
