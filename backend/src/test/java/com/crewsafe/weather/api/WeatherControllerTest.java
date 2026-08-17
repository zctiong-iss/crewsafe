package com.crewsafe.weather.api;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import com.crewsafe.weather.repository.WeatherObservationRepository;
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

/** End-to-end contract and site-authorization tests for the live-board weather API.
 *
 * @author Justin Chua
 */
@AutoConfigureMockMvc
class WeatherControllerTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private WeatherObservationRepository observations;

    private Site visibleSite;
    private Site otherSite;
    private String visibleSiteToken;

    @BeforeEach
    void setUp() {
        visibleSite = createSite("Visible");
        otherSite = createSite("Other");

        String username = "weather-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser supervisor = users.save(new AppUser(
                username, subFor(username), "Weather Supervisor", Role.SUPERVISOR));
        memberships.save(new SiteMembership(supervisor.getId(), visibleSite.getId()));
        visibleSiteToken = mintAccessToken(username);
    }

    @Test
    void returnsTheNewestStoredWeatherForAnAccessibleSite() throws Exception {
        insertObservation(visibleSite.getId(), Instant.parse("2026-08-03T01:00:00Z"),
                new BigDecimal("29.10"), WeatherQualityStatus.DELAYED);
        insertObservation(visibleSite.getId(), Instant.parse("2026-08-03T01:15:00Z"),
                new BigDecimal("31.40"), WeatherQualityStatus.LIVE);

        mockMvc.perform(authenticatedGet(visibleSite.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.siteId").value(visibleSite.getId().toString()))
                .andExpect(jsonPath("$.wbgt").value(31.4))
                .andExpect(jsonPath("$.temperature").value(32.2))
                .andExpect(jsonPath("$.humidity").value(70.0))
                .andExpect(jsonPath("$.windSpeed").value(2.5))
                .andExpect(jsonPath("$.rainfall").value(0.0))
                .andExpect(jsonPath("$.observedAt").value("2026-08-03T01:15:00Z"))
                .andExpect(jsonPath("$.source").value("NEA"))
                // Freshness is evaluated now, not frozen as LIVE when the old row was stored.
                .andExpect(jsonPath("$.qualityStatus").value("STALE"))
                .andExpect(jsonPath("$.stationId").value("S-test"))
                // Evaluated server-side and shipped beside the reading (SCRUM-209): a client
                // renders the band, it never derives one. 31.4 sits in the 31-to-below-32 band.
                .andExpect(jsonPath("$.band").value("31_TO_BELOW_32"));
    }

    @Test
    void returnsNotFoundUntilIngestionHasStoredWeather() throws Exception {
        mockMvc.perform(authenticatedGet(visibleSite.getId()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    void rejectsAUserFromAnotherSite() throws Exception {
        insertObservation(otherSite.getId(), Instant.parse("2026-08-03T01:15:00Z"),
                new BigDecimal("31.40"), WeatherQualityStatus.LIVE);

        mockMvc.perform(authenticatedGet(otherSite.getId()))
                .andExpect(status().isForbidden());
    }

    @Test
    void requiresAuthentication() throws Exception {
        mockMvc.perform(get(endpoint(visibleSite.getId())))
                .andExpect(status().isUnauthorized());
    }

    private Site createSite(String label) {
        return sites.save(new Site("Weather " + label + " " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder authenticatedGet(
            UUID siteId) {
        return get(endpoint(siteId)).header("Authorization", "Bearer " + visibleSiteToken);
    }

    private String endpoint(UUID siteId) {
        return "/api/v1/sites/" + siteId + "/weather/latest";
    }

    private void insertObservation(UUID siteId, Instant observedAt, BigDecimal wbgt,
                                   WeatherQualityStatus qualityStatus) {
        observations.insertIfAbsent(new WeatherObservationRepository.InsertObservationCommand(
                UUID.randomUUID(), siteId, wbgt, new BigDecimal("32.20"),
                new BigDecimal("70.00"), new BigDecimal("2.50"), BigDecimal.ZERO,
                observedAt, observedAt.plusSeconds(10), WeatherSource.NEA.name(),
                qualityStatus.name(), "S-test"));
    }
}
