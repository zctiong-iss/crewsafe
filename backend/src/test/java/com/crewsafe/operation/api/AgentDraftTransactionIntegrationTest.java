package com.crewsafe.operation.api;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.mitigation.ai.bedrock.AgentDraftClient;
import com.crewsafe.operation.repository.RecommendationRepository;
import com.crewsafe.policy.domain.PolicyVersion;
import com.crewsafe.policy.domain.PolicyVersionStatus;
import com.crewsafe.policy.repository.PolicyVersionRepository;
import com.crewsafe.shift.domain.Intensity;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;

import java.lang.reflect.Constructor;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Regression coverage for a real bug found live during SCRUM-289 forecast wiring, not one
 * discovered by inspection: a supervisor tapped "Draft a plan" repeatedly, got "No plan drafted"
 * every time, and every one of those attempts had actually silently discarded a fully-drafted
 * recommendation.
 *
 * <p>The mechanism only exists at the real Spring transaction boundary, which is exactly why
 * {@code AgentDraftServiceTest} (Mockito mocks, no real transaction manager) and {@code
 * AgentDraftEndpointTest} ({@link AgentDraftClient}'s whole caller mocked out) both structurally
 * cannot catch it. {@code SiteForecastService} is {@code @Transactional} and, prior to the fix,
 * used the default {@code REQUIRED} propagation — so calling it from inside {@code
 * AgentDraftService.generate()}'s own transaction meant it joined that same transaction rather
 * than opening its own. When it threw {@code ForecastUnavailableException} — an expected, §7.1
 * degrade-not-fail outcome that {@code AgentDraftService.fetchForecast} already catches and
 * handles — Spring's transaction interceptor still marked the shared transaction rollback-only
 * the moment the exception crossed that proxy boundary, before the catch block ever ran. Nothing
 * downstream saw a problem: the plan drafted, the save appeared to succeed, "recommendation
 * drafted" logged. Only at the very end, when the outer transaction tried to commit, did Spring
 * discover it had already been condemned and throw {@code UnexpectedRollbackException} instead —
 * a caught, handled exception silently losing a write nowhere near it.
 *
 * <p>This test does not need ml-service or Bedrock to be running: {@link AgentDraftClient} is
 * mocked to fail too, exercising the same "everything degraded, still get a plan" path the
 * production incident did. What it cannot mock away is the one thing that mattered — a real
 * {@code WeatherObservationRepository}-backed database and Spring's real transaction manager,
 * which is the only combination that can reproduce a proxy-boundary rollback bug at all.
 *
 * @author Abu Bakar
 */
@AutoConfigureMockMvc
class AgentDraftTransactionIntegrationTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private ShiftRepository shifts;
    @Autowired private ShiftAssignmentRepository shiftAssignments;
    @Autowired private WeatherObservationRepository weatherObservations;
    @Autowired private PolicyVersionRepository policyVersions;
    @Autowired private RecommendationRepository recommendations;

    // Mocked so this test needs neither ml-service nor Bedrock. It is made to fail, on purpose:
    // that is what the incident's request shape actually was (SiteForecastService AND
    // AgentDraftClient both degraded), and it means this test needs no fragile echo-back of
    // exactly which mitigations a mocked response must return to satisfy the §8.5 gate.
    @MockitoBean private AgentDraftClient agentDraftClient;

    private Site site;
    private Shift shift;
    private String supervisorToken;

    @BeforeEach
    void setUp() {
        site = sites.save(new Site("Forecast Rollback " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
        supervisorToken = tokenFor(Role.SUPERVISOR, site);

        policyVersions.save(activePolicy(site.getId()));

        // Deliberately exactly one reading. WeatherQueryService.findLatestForSite is satisfied by
        // one row (so the draft is not rejected for having no reading at all), but
        // SiteForecastService.forecast requires at least two to build a trained-model context and
        // throws ForecastUnavailableException on a single row - the same class of failure the
        // live incident hit, reached the same way a real new site would reach it.
        weatherObservations.save(observation(site.getId(), new BigDecimal("32.50")));

        shift = shifts.save(new Shift(site.getId(), Instant.now().truncatedTo(ChronoUnit.SECONDS),
                Instant.now().plus(8, ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS)));
        UUID workerId = worker(site);
        shiftAssignments.save(new ShiftAssignment(shift.getId(), workerId, "Rebar",
                Intensity.HEAVY, 2));

        when(agentDraftClient.draft(any())).thenThrow(new RuntimeException("simulated ml-service failure"));
    }

    @Test
    @DisplayName("A degraded forecast does not roll back the recommendation it was drafted alongside")
    void degradedForecastDoesNotDiscardTheDraft() throws Exception {
        mockMvc.perform(post("/api/v1/sites/" + site.getId() + "/shifts/" + shift.getId()
                        + "/recommendations/generate")
                        .header("Authorization", "Bearer " + supervisorToken))
                .andExpect(status().isCreated());

        assertThat(recommendations.findByShiftId(shift.getId())).hasSize(1);
    }

    private PolicyVersion activePolicy(UUID siteId) {
        BigDecimal t = new BigDecimal("25.0");
        return PolicyVersion.builder()
                .id(UUID.randomUUID())
                .siteId(siteId)
                .versionLabel("TEST-POLICY-" + UUID.randomUUID())
                .source("Test fixture")
                .effectiveDate(LocalDate.now())
                .status(PolicyVersionStatus.ACTIVE)
                .wbgtThresholdUnacclimatisedLight(t)
                .wbgtThresholdUnacclimatisedModerate(t)
                .wbgtThresholdUnacclimatisedHeavy(t)
                .wbgtThresholdPartialLight(t)
                .wbgtThresholdPartialModerate(t)
                .wbgtThresholdPartialHeavy(t)
                .wbgtThresholdFullLight(t)
                .wbgtThresholdFullModerate(t)
                .wbgtThresholdFullHeavy(t)
                .wbgtEmergencyStop(new BigDecimal("33.0"))
                .build();
    }

    /** {@link WeatherObservation} exposes only a protected no-arg constructor by design. */
    private static WeatherObservation observation(UUID siteId, BigDecimal wbgt) {
        try {
            Constructor<WeatherObservation> constructor = WeatherObservation.class.getDeclaredConstructor();
            constructor.setAccessible(true);
            WeatherObservation observation = constructor.newInstance();
            ReflectionTestUtils.setField(observation, "id", UUID.randomUUID());
            ReflectionTestUtils.setField(observation, "siteId", siteId);
            ReflectionTestUtils.setField(observation, "wbgt", wbgt);
            ReflectionTestUtils.setField(observation, "observedAt", Instant.now().truncatedTo(ChronoUnit.SECONDS));
            ReflectionTestUtils.setField(observation, "ingestedAt", Instant.now().truncatedTo(ChronoUnit.SECONDS));
            ReflectionTestUtils.setField(observation, "source", WeatherSource.NEA);
            ReflectionTestUtils.setField(observation, "qualityStatus", WeatherQualityStatus.LIVE);
            ReflectionTestUtils.setField(observation, "stationId", "S50");
            return observation;
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    private String tokenFor(Role role, Site site) {
        String username = "agent-draft-tx-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), "Agent Draft Tx " + role, role));
        memberships.save(new SiteMembership(created.getId(), site.getId()));
        return mintAccessToken(username);
    }

    private UUID worker(Site site) {
        String username = "agent-draft-tx-worker-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), "Agent Draft Tx Worker", Role.WORKER));
        memberships.save(new SiteMembership(created.getId(), site.getId()));
        return created.getId();
    }
}
