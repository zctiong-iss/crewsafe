package com.crewsafe.operation.api;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.SiteMembership;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.mitigation.ai.bedrock.AgentDraftClient;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.repository.ActionDispatchRepository;
import com.crewsafe.operation.repository.ApprovalRepository;
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
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Real-database coverage for SCRUM-440's auto-dispatch path — the part {@code
 * AgentDraftServiceTest}'s mocks cannot prove: that {@code action_dispatch.recommendation_id}
 * actually satisfies its {@code NOT NULL} constraint with no {@code Approval} in the picture,
 * and that the resulting dispatch is genuinely visible through {@code
 * ActionDispatchRepository#findByShiftId} — the exact query that used to reach a dispatch only
 * via {@code approval.recommendation.shiftId}, an implicit inner join that would have hidden
 * a null-approval row from the SCRUM-317 site action-status stream forever.
 *
 * @author Abu Bakar
 */
@AutoConfigureMockMvc
class AutoDispatchStopWorkIntegrationTest extends AbstractIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private AppUserRepository users;
    @Autowired private SiteRepository sites;
    @Autowired private SiteMembershipRepository memberships;
    @Autowired private ShiftRepository shifts;
    @Autowired private ShiftAssignmentRepository shiftAssignments;
    @Autowired private WeatherObservationRepository weatherObservations;
    @Autowired private PolicyVersionRepository policyVersions;
    @Autowired private RecommendationRepository recommendations;
    @Autowired private ApprovalRepository approvals;
    @Autowired private ActionDispatchRepository actionDispatches;

    // A WBGT-max emergency stop never calls the model (rejectionReason would demand it anyway),
    // but modelDraft() still fetches a forecast and, if that model path were reached, would call
    // this — mocked so the test needs no ml-service, same technique as
    // AgentDraftTransactionIntegrationTest.
    @MockitoBean private AgentDraftClient agentDraftClient;

    private Site site;
    private Shift shift;
    private UUID workerId;
    private String supervisorToken;

    @BeforeEach
    void setUp() {
        site = sites.save(new Site("Auto Dispatch " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
        supervisorToken = tokenFor(Role.SUPERVISOR, site);

        policyVersions.save(emergencyStopPolicy(site.getId()));

        // 34.0°C breaches the 33.0°C emergency-stop threshold configured below.
        weatherObservations.save(observation(site.getId(), new BigDecimal("34.00")));

        shift = shifts.save(new Shift(site.getId(), Instant.now().truncatedTo(ChronoUnit.SECONDS),
                Instant.now().plus(8, ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS)));
        workerId = worker(site);
        shiftAssignments.save(new ShiftAssignment(shift.getId(), workerId, "Rebar", Intensity.HEAVY, 2));

        when(agentDraftClient.draft(any())).thenThrow(new RuntimeException("should not be called"));
    }

    @Test
    @DisplayName("A WBGT-max breach is persisted AUTO_DISPATCHED, with real dispatches and no approval")
    void wbgtMaxBreachAutoDispatchesForReal() throws Exception {
        mockMvc.perform(post("/api/v1/sites/" + site.getId() + "/shifts/" + shift.getId()
                        + "/recommendations/generate")
                        .header("Authorization", "Bearer " + supervisorToken))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("AUTO_DISPATCHED"));

        List<Recommendation> forShift = recommendations.findByShiftId(shift.getId());
        assertThat(forShift).hasSize(1);
        Recommendation saved = forShift.get(0);
        assertThat(saved.getStatus()).isEqualTo(Recommendation.RecommendationStatus.AUTO_DISPATCHED);

        // No Approval exists at all -- the whole point of the bypass.
        assertThat(approvals.findByRecommendationId(saved.getId())).isEmpty();

        // The dispatches exist, have no approval, and — the actual regression this test
        // guards — are visible through the shift-scoped query the SCRUM-317 stream uses.
        List<ActionDispatch> dispatches = actionDispatches.findByShiftId(shift.getId());
        assertThat(dispatches).isNotEmpty();
        assertThat(dispatches).allSatisfy(dispatch -> {
            assertThat(dispatch.getApproval()).isNull();
            assertThat(dispatch.getRecommendation().getId()).isEqualTo(saved.getId());
            assertThat(dispatch.getWorker().getId()).isEqualTo(workerId);
        });
        assertThat(dispatches.stream().map(ActionDispatch::getActionCode))
                .contains("STOP_WORK");
    }

    private PolicyVersion emergencyStopPolicy(UUID siteId) {
        BigDecimal t = new BigDecimal("25.0");
        return PolicyVersion.builder()
                .id(UUID.randomUUID())
                .siteId(siteId)
                .versionLabel("EMERGENCY-" + UUID.randomUUID())
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
        String username = "auto-dispatch-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), "Auto Dispatch Test " + role, role));
        memberships.save(new SiteMembership(created.getId(), site.getId()));
        return mintAccessToken(username);
    }

    private UUID worker(Site site) {
        String username = "auto-dispatch-worker-" + UUID.randomUUID();
        createCognitoUser(username);
        AppUser created = users.save(new AppUser(username, subFor(username), "Auto Dispatch Worker", Role.WORKER));
        memberships.save(new SiteMembership(created.getId(), site.getId()));
        return created.getId();
    }
}
