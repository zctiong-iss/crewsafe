package com.crewsafe.lightning.api;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.lightning.repository.LightningObservationRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The polled lightning endpoint (SCRUM-261).
 *
 * <p>The case that matters most is {@link #returnsNotFoundWhenNothingHasBeenIngested()}. A
 * client that received {@code CLEAR} because the scheduler was switched off would show a crew a
 * cheerful all-clear during a storm, and nothing on the screen would look wrong. That is the
 * distinction the derivation service models as an empty {@code Optional}, and this asserts it
 * survives the trip over HTTP.
 *
 * <p>{@link #allowsAWorkerOnTheSite()} is the reason the endpoint exists at all: the conditions
 * SSE stream that already carries this state is restricted to supervisors and above, while the
 * banner that needs it is on the worker's own shift screen.
 *
 * @author Justin Chua
 */
@AutoConfigureMockMvc
class LightningControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private LightningObservationRepository observations;

    private Site visibleSite;
    private Site otherSite;
    private String workerToken;

    @BeforeEach
    void setUp() {
        visibleSite = createSite("Visible");
        otherSite = createSite("Other");

        String username = "lightning-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser worker = users.save(new AppUser(
                username, subFor(username), "Lightning Worker", Role.WORKER));
        memberships.save(new SiteMembership(worker.getId(), visibleSite.getId()));
        workerToken = mintAccessToken(username);
    }

    @Test
    void allowsAWorkerOnTheSite() throws Exception {
        // A WORKER, deliberately. The SSE stream requires SUPERVISOR or above, which is exactly
        // the gap this endpoint closes — the stop-work banner is on the worker's own screen.
        insertObservation(visibleSite.getId(), Instant.now().minusSeconds(60),
                new BigDecimal("4.00"), WeatherQualityStatus.LIVE);

        mockMvc.perform(authenticatedGet(visibleSite.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.siteId").value(visibleSite.getId().toString()))
                // 4 km is inside the 10 km stop-work radius.
                .andExpect(jsonPath("$.state").value("STOP_WORK"))
                .andExpect(jsonPath("$.nearestStrikeKm").value(4.0))
                // The client refuses to treat a lapsed assessment as an all-clear, which only
                // works because the server says when the assessment stops being trustworthy.
                .andExpect(jsonPath("$.validUntil").exists())
                .andExpect(jsonPath("$.freshness").exists());
    }

    @Test
    void reportsClearWhenTheNearestStrikeIsOutsideBothRadii() throws Exception {
        insertObservation(visibleSite.getId(), Instant.now().minusSeconds(60),
                new BigDecimal("45.00"), WeatherQualityStatus.LIVE);

        mockMvc.perform(authenticatedGet(visibleSite.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("CLEAR"));
    }

    @Test
    void returnsNotFoundWhenNothingHasBeenIngested() throws Exception {
        // NOT a CLEAR body. "No data" and "no lightning" are the same pixels and opposite
        // meanings on a stop-work surface; flattening one into the other is how a crew gets
        // told it is safe by a scheduler that was never switched on.
        mockMvc.perform(authenticatedGet(visibleSite.getId()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    void rejectsAUserFromAnotherSite() throws Exception {
        insertObservation(otherSite.getId(), Instant.now().minusSeconds(60),
                new BigDecimal("2.00"), WeatherQualityStatus.LIVE);

        mockMvc.perform(authenticatedGet(otherSite.getId()))
                .andExpect(status().isForbidden());
    }

    @Test
    void requiresAuthentication() throws Exception {
        mockMvc.perform(get(endpoint(visibleSite.getId())))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void listsObservationsNewestFirst() throws Exception {
        Instant older = Instant.now().minusSeconds(240);
        Instant newer = Instant.now().minusSeconds(60);
        insertObservation(visibleSite.getId(), older, new BigDecimal("30.00"), WeatherQualityStatus.LIVE);
        insertObservation(visibleSite.getId(), newer, null, WeatherQualityStatus.LIVE);

        mockMvc.perform(authenticatedGetObservations(visibleSite.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].observedAt").value(newer.toString()))
                // No strikes that tick is a valid outcome, not a missing value.
                .andExpect(jsonPath("$[0].nearestStrikeKm").doesNotExist())
                .andExpect(jsonPath("$[1].observedAt").value(older.toString()))
                .andExpect(jsonPath("$[1].nearestStrikeKm").value(30.0));
    }

    @Test
    void returnsAnEmptyListRatherThanNotFoundWhenNothingHasBeenIngested() throws Exception {
        // Unlike the derived risk endpoint, this is a history view: "nothing ingested yet" and
        // "nothing ingested recently" both just render as an empty table, not a 404.
        mockMvc.perform(authenticatedGetObservations(visibleSite.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void excludesAnotherSitesObservationsFromTheList() throws Exception {
        insertObservation(otherSite.getId(), Instant.now().minusSeconds(60),
                new BigDecimal("2.00"), WeatherQualityStatus.LIVE);

        mockMvc.perform(authenticatedGetObservations(otherSite.getId()))
                .andExpect(status().isForbidden());
    }

    private Site createSite(String label) {
        return sites.save(new Site("Lightning " + label + " " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
    }

    private void insertObservation(UUID siteId, Instant observedAt, BigDecimal nearestStrikeKm,
                                   WeatherQualityStatus qualityStatus) {
        observations.insertIfAbsent(
                UUID.randomUUID(), siteId, nearestStrikeKm, observedAt, observedAt,
                Instant.now(), WeatherSource.NEA.name(), qualityStatus.name());
    }

    private MockHttpServletRequestBuilder authenticatedGet(UUID siteId) {
        return get(endpoint(siteId)).header("Authorization", "Bearer " + workerToken);
    }

    private MockHttpServletRequestBuilder authenticatedGetObservations(UUID siteId) {
        return get(endpoint(siteId) + "/observations").header("Authorization", "Bearer " + workerToken);
    }

    private String endpoint(UUID siteId) {
        return "/api/v1/sites/" + siteId + "/lightning";
    }
}
