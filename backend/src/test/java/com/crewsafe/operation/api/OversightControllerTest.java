package com.crewsafe.operation.api;

import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.operation.repository.RecommendationRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The cross-site plan counts behind the oversight list.
 *
 * <p>The behaviour worth protecting is that a site with nothing drafted still comes back, with
 * zeroes. A {@code GROUP BY} cannot emit a row for a site that has no plans, so without the
 * fill-in step the client would have to know that an absent site means zero — and a screen
 * whose job is surfacing outstanding work is the wrong place to rely on that.
 *
 * @author Justin Chua
 */
@ExtendWith(MockitoExtension.class)
class OversightControllerTest {

    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID SITE_A = UUID.randomUUID();
    private static final UUID SITE_B = UUID.randomUUID();

    @Mock private RecommendationRepository recommendations;
    @Mock private SiteMembershipRepository memberships;
    @Mock private AppUserRepository users;
    @InjectMocks private OversightController controller;

    private CrewSafeUserPrincipal principal() {
        CrewSafeUserPrincipal principal = mock(CrewSafeUserPrincipal.class);
        when(principal.getId()).thenReturn(USER_ID);
        return principal;
    }

    /**
     * A plain implementation rather than a mock. Building one inside a {@code when(...)}
     * argument means stubbing while another stubbing is open, which Mockito rejects as an
     * UnfinishedStubbingException — and the projection is three getters, so a mock buys nothing.
     */
    private record Counts(UUID getSiteId, long getAwaitingDecision, long getTotalPlans)
            implements RecommendationRepository.SitePlanCounts {

        @Override
        public UUID getSiteId() {
            return getSiteId;
        }

        @Override
        public long getAwaitingDecision() {
            return getAwaitingDecision;
        }

        @Override
        public long getTotalPlans() {
            return getTotalPlans;
        }
    }

    /** Same reasoning as {@link Counts}: a plain implementation, not a mock. */
    private record SiteUserRow(UUID getSiteId, UUID getUserId, String getDisplayName)
            implements AppUserRepository.SiteUser {

        @Override
        public UUID getSiteId() {
            return getSiteId;
        }

        @Override
        public UUID getUserId() {
            return getUserId;
        }

        @Override
        public String getDisplayName() {
            return getDisplayName;
        }
    }

    /** Strict stubs, so this is set only in the tests that actually reach the query. */
    private void noSupervisors() {
        when(users.findBySiteIdsAndRoleAndStatus(any(), any(), any())).thenReturn(List.of());
    }

    private static RecommendationRepository.SitePlanCounts counts(
            UUID siteId, long awaiting, long total) {
        return new Counts(siteId, awaiting, total);
    }

    @Test
    @DisplayName("Counts every membership, including a site with nothing drafted")
    void returnsZeroesForASiteWithNoPlans() {
        when(memberships.findSiteIdsByUserId(USER_ID)).thenReturn(List.of(SITE_A, SITE_B));
        when(recommendations.countPlansBySite(any())).thenReturn(List.of(counts(SITE_A, 2, 5)));
        noSupervisors();

        List<OversightController.SitePlanSummary> body =
                controller.planSummary(principal()).getBody();

        assertThat(body).containsExactly(
                new OversightController.SitePlanSummary(SITE_A, 2, 5, List.of()),
                new OversightController.SitePlanSummary(SITE_B, 0, 0, List.of()));
    }

    /*
     * The regression this endpoint exists for. Before it, an unexpanded site reported zero
     * awaiting because nothing had been fetched — identical on screen to a site with nothing
     * outstanding, so a manager could pass over a site with a plan pending approval.
     */
    @Test
    @DisplayName("A site with work outstanding reports it without anyone expanding it")
    void reportsOutstandingWorkBeforeAnythingIsExpanded() {
        when(memberships.findSiteIdsByUserId(USER_ID)).thenReturn(List.of(SITE_B));
        when(recommendations.countPlansBySite(any())).thenReturn(List.of(counts(SITE_B, 1, 1)));
        noSupervisors();

        List<OversightController.SitePlanSummary> body =
                controller.planSummary(principal()).getBody();

        assertThat(body).singleElement()
                .extracting(OversightController.SitePlanSummary::awaitingDecision)
                .isEqualTo(1L);
    }

    /** No memberships means no query at all — an IN () clause with nothing in it. */
    @Test
    @DisplayName("A caller with no memberships gets an empty list and costs no query")
    void noMembershipsSkipsTheQuery() {
        when(memberships.findSiteIdsByUserId(USER_ID)).thenReturn(List.of());

        assertThat(controller.planSummary(principal()).getBody()).isEmpty();
        verify(recommendations, never()).countPlansBySite(any());
    }

    @Test
    @DisplayName("Scope comes from the caller's own memberships, never from the request")
    void scopeIsDerivedFromTheCallerAlone() {
        when(memberships.findSiteIdsByUserId(USER_ID)).thenReturn(List.of(SITE_A));
        when(recommendations.countPlansBySite(any())).thenReturn(List.of());
        noSupervisors();

        List<OversightController.SitePlanSummary> body =
                controller.planSummary(principal()).getBody();

        assertThat(body).extracting(OversightController.SitePlanSummary::siteId)
                .containsExactly(SITE_A);
        verify(memberships).findSiteIdsByUserId(USER_ID);
    }

    /*
     * The pill this feeds names who is accountable for a SITE, not who authored a plan. Nothing
     * records a plan's creator, and generateAuto passes a null actor because the scheduler
     * drafts most of them with no human involved -- so site accountability is the question that
     * has an answer for every plan, whatever its status.
     */
    @Test
    @DisplayName("Every site carries its supervisors, in one query rather than one per site")
    void namesEachSitesSupervisors() {
        UUID supervisorOne = UUID.randomUUID();
        UUID supervisorTwo = UUID.randomUUID();
        when(memberships.findSiteIdsByUserId(USER_ID)).thenReturn(List.of(SITE_A, SITE_B));
        when(recommendations.countPlansBySite(any())).thenReturn(List.of());
        when(users.findBySiteIdsAndRoleAndStatus(any(), any(), any())).thenReturn(List.of(
                new SiteUserRow(SITE_A, supervisorOne, "Meng Hui"),
                new SiteUserRow(SITE_A, supervisorTwo, "Zhong Cheng")));

        List<OversightController.SitePlanSummary> body =
                controller.planSummary(principal()).getBody();

        assertThat(body).hasSize(2);
        assertThat(body.getFirst().supervisors())
                .extracting(OversightController.SiteSupervisor::displayName)
                .containsExactly("Meng Hui", "Zhong Cheng");
        // A site with no supervisor gets an empty list, never a null the client must guard.
        assertThat(body.get(1).supervisors()).isEmpty();
        verify(users).findBySiteIdsAndRoleAndStatus(any(), any(), any());
    }
}
