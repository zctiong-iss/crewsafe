package com.crewsafe.operation.service;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.mitigation.ai.bedrock.AgentDraftClient;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.domain.SiteConditionState;
import com.crewsafe.operation.repository.RecommendationRepository;
import com.crewsafe.operation.repository.SiteConditionStateRepository;
import com.crewsafe.policy.domain.PolicyVersion;
import com.crewsafe.policy.domain.PolicyVersionStatus;
import com.crewsafe.policy.repository.PolicyVersionRepository;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WbgtBand;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;

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

/**
 * Real-database coverage for {@link RecommendationAutoTriggerService} and the {@link
 * ShiftRepository#findEligibleForAutoTrigger} query behind it (SCRUM-291) — the shift-state
 * guard's boundary conditions and the transition-detected-then-supersede path both depend on
 * SQL that {@link RecommendationAutoTriggerServiceTest}'s mocks cannot exercise.
 *
 * @author Abu Bakar
 */
class RecommendationAutoTriggerIntegrationTest extends AbstractIntegrationTest {

    @Autowired private SiteRepository sites;
    @Autowired private ShiftRepository shifts;
    @Autowired private WeatherObservationRepository weatherObservations;
    @Autowired private PolicyVersionRepository policyVersions;
    @Autowired private RecommendationRepository recommendations;
    @Autowired private SiteConditionStateRepository conditionStates;
    @Autowired private RecommendationAutoTriggerService autoTriggerService;

    // Mocked so this needs no ml-service: every draft in these tests falls back to the
    // deterministic plan, the same technique AgentDraftTransactionIntegrationTest uses.
    @MockitoBean private AgentDraftClient agentDraftClient;

    private Site site;
    private Instant now;

    @BeforeEach
    void setUp() {
        site = sites.save(new Site("Auto Trigger " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
        now = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        when(agentDraftClient.draft(any())).thenThrow(new RuntimeException("no ml-service in this test"));
    }

    // ------------------------------------------------------------------------------------
    // ShiftRepository#findEligibleForAutoTrigger boundary conditions
    // ------------------------------------------------------------------------------------

    @Test
    @DisplayName("An ACTIVE shift that has not ended is eligible")
    void activeShiftNotYetEndedIsEligible() {
        Shift shift = activate(shift(now.minusSeconds(7200), now.plusSeconds(7200)));

        assertThat(eligibleIds()).contains(shift.getId());
    }

    @Test
    @DisplayName("An ACTIVE shift that has already ended is not eligible, even though SCRUM-441 never auto-closes it")
    void activeShiftAlreadyEndedIsNotEligible() {
        Shift shift = activate(shift(now.minusSeconds(14400), now.minusSeconds(3600)));

        assertThat(eligibleIds()).doesNotContain(shift.getId());
    }

    @Test
    @DisplayName("A PLANNED shift starting within the lead window is eligible")
    void plannedShiftWithinLeadWindowIsEligible() {
        Shift shift = shift(now.plusSeconds(600), now.plusSeconds(30000));

        assertThat(eligibleIds()).contains(shift.getId());
    }

    @Test
    @DisplayName("A PLANNED shift starting beyond the lead window is not eligible")
    void plannedShiftBeyondLeadWindowIsNotEligible() {
        Shift shift = shift(now.plusSeconds(7200), now.plusSeconds(30000));

        assertThat(eligibleIds()).doesNotContain(shift.getId());
    }

    @Test
    @DisplayName("A CANCELLED shift is never eligible, even within what would otherwise be the lead window")
    void cancelledShiftIsNeverEligible() {
        Shift shift = shifts.save(new Shift(site.getId(), now.plusSeconds(600), now.plusSeconds(30000)));
        shift.cancel();
        shifts.save(shift);

        assertThat(eligibleIds()).doesNotContain(shift.getId());
    }

    @Test
    @DisplayName("A shift on a different site is never eligible")
    void shiftOnAnotherSiteIsNotEligible() {
        Site otherSite = sites.save(new Site("Other " + UUID.randomUUID(),
                new BigDecimal("1.300000"), new BigDecimal("103.800000")));
        Shift shift = activate(shifts.save(new Shift(otherSite.getId(),
                now.minusSeconds(3600), now.plusSeconds(3600))));

        assertThat(eligibleIds()).doesNotContain(shift.getId());
    }

    private List<UUID> eligibleIds() {
        return shifts.findEligibleForAutoTrigger(site.getId(), now, now.plusSeconds(1800))
                .stream().map(Shift::getId).toList();
    }

    private Shift shift(Instant startsAt, Instant endsAt) {
        return shifts.save(new Shift(site.getId(), startsAt, endsAt));
    }

    private Shift activate(Shift shift) {
        shift.activate();
        return shifts.save(shift);
    }

    // ------------------------------------------------------------------------------------
    // End-to-end: a real band transition drafts a recommendation and supersedes the old one
    // ------------------------------------------------------------------------------------

    @Test
    @DisplayName("A real band transition drafts a PENDING_APPROVAL recommendation for an eligible shift")
    void bandTransitionDraftsARecommendation() {
        policyVersions.save(activePolicy(site.getId()));
        weatherObservations.save(observation(site.getId(), new BigDecimal("32.50")));
        Shift shift = activate(shift(now.minusSeconds(3600), now.plusSeconds(3600)));

        conditionStates.save(new SiteConditionState(site.getId(), WbgtBand.BAND_31_TO_BELOW_32, null, now.minusSeconds(60)));

        // Not asserted against the exact count: evaluateAllSites() sweeps every site in this
        // shared test container, not just this test's, so the only robust check is this
        // shift's own recommendations.
        autoTriggerService.evaluateAllSites();

        List<Recommendation> forShift = recommendations.findByShiftId(shift.getId());
        assertThat(forShift).hasSize(1);
        assertThat(forShift.get(0).getStatus()).isEqualTo(Recommendation.RecommendationStatus.PENDING_APPROVAL);
    }

    @Test
    @DisplayName("An open PENDING_APPROVAL recommendation is superseded, not stacked on")
    void openRecommendationIsSupersededNotStacked() {
        policyVersions.save(activePolicy(site.getId()));
        weatherObservations.save(observation(site.getId(), new BigDecimal("32.50")));
        Shift shift = activate(shift(now.minusSeconds(3600), now.plusSeconds(3600)));

        Recommendation existing = recommendations.save(Recommendation.builder()
                .id(UUID.randomUUID())
                .shiftId(shift.getId())
                .status(Recommendation.RecommendationStatus.PENDING_APPROVAL)
                .createdAt(now.minusSeconds(600))
                .build());

        conditionStates.save(new SiteConditionState(site.getId(), WbgtBand.BAND_31_TO_BELOW_32, null, now.minusSeconds(60)));

        autoTriggerService.evaluateAllSites();

        List<Recommendation> forShift = recommendations.findByShiftId(shift.getId());
        assertThat(forShift).hasSize(2);
        assertThat(forShift.stream().map(Recommendation::getStatus))
                .containsExactlyInAnyOrder(
                        Recommendation.RecommendationStatus.SUPERSEDED,
                        Recommendation.RecommendationStatus.PENDING_APPROVAL);
        Recommendation reloadedExisting = recommendations.findById(existing.getId()).orElseThrow();
        assertThat(reloadedExisting.getStatus()).isEqualTo(Recommendation.RecommendationStatus.SUPERSEDED);
    }

    @Test
    @DisplayName("No transition means no draft, even with an eligible shift on the site")
    void noTransitionMeansNoDraft() {
        weatherObservations.save(observation(site.getId(), new BigDecimal("32.50")));
        Shift shift = activate(shift(now.minusSeconds(3600), now.plusSeconds(3600)));
        conditionStates.save(new SiteConditionState(site.getId(), WbgtBand.BAND_32_TO_BELOW_33, null, now.minusSeconds(60)));

        autoTriggerService.evaluateAllSites();

        assertThat(recommendations.findByShiftId(shift.getId())).isEmpty();
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
    private WeatherObservation observation(UUID siteId, BigDecimal wbgt) {
        try {
            Constructor<WeatherObservation> constructor = WeatherObservation.class.getDeclaredConstructor();
            constructor.setAccessible(true);
            WeatherObservation observation = constructor.newInstance();
            ReflectionTestUtils.setField(observation, "id", UUID.randomUUID());
            ReflectionTestUtils.setField(observation, "siteId", siteId);
            ReflectionTestUtils.setField(observation, "wbgt", wbgt);
            ReflectionTestUtils.setField(observation, "observedAt", now);
            ReflectionTestUtils.setField(observation, "ingestedAt", now);
            ReflectionTestUtils.setField(observation, "source", WeatherSource.NEA);
            ReflectionTestUtils.setField(observation, "qualityStatus", WeatherQualityStatus.LIVE);
            ReflectionTestUtils.setField(observation, "stationId", "S50");
            return observation;
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }
}
