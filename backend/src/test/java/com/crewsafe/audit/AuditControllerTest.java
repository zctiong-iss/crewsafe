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
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
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

        String csv = mockMvc.perform(get("/api/v1/sites/" + site.getId() + "/audit/export.csv")
                        .param("from", from.toString()).param("to", to.toString())
                        .header("Authorization", "Bearer " + managerToken))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition",
                        org.hamcrest.Matchers.containsString("attachment; filename=")))
                .andReturn().getResponse().getContentAsString();

        // Header present, and the comma-bearing detail is wrapped in quotes rather than split.
        assertThat(csv).contains("occurred_at,actor,event,event_type");
        assertThat(csv).contains("\"Created shift, night crew\"");
        assertThat(csv).contains(manager.getDisplayName());
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
}
