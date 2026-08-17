package com.crewsafe.operation.api;

import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.UserStatus;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.operation.repository.RecommendationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Cross-site counts for the safety manager's oversight list (SCRUM-TBD-90 follow-up).
 *
 * <h2>Why this is not under {@code /sites/{siteId}/…}</h2>
 *
 * Every other plan endpoint is site-scoped and gated with
 * {@code @PreAuthorize("@siteAccess.canAccess(#siteId)")}, which is right when the caller names
 * the site. This one answers "across everything I oversee, where is work outstanding?", and a
 * manager may hold twenty memberships — asking it site by site is the twenty requests this
 * endpoint exists to collapse into one.
 *
 * <p>Consequently there is no {@code siteId} parameter to check, and that is the point rather
 * than an omission: the scope comes from the caller's own memberships, read server-side from
 * the same {@link SiteMembershipRepository#findSiteIdsByUserId} that backs {@code GET /me}. A
 * caller cannot widen it, because they never name what they are asking about.
 *
 * <h2>What it is for</h2>
 *
 * {@code OversightScreen} loads a site's plans only when a manager expands it, which is the
 * right call for twenty sites. The cost was that an unexpanded site reported zero plans
 * awaiting a decision — indistinguishable from a site with genuinely nothing outstanding. A
 * manager could scan the list and pass over a site with a plan pending approval, on a screen
 * whose whole purpose is preventing exactly that. This makes the count true on arrival while
 * leaving the detail lazy.
 *
 * @author Justin Chua
 */
@RestController
@RequestMapping("/api/v1/oversight")
@RequiredArgsConstructor
public class OversightController {

    private final RecommendationRepository recommendations;
    private final SiteMembershipRepository memberships;
    private final AppUserRepository users;

    /**
     * A supervisor accountable for a site — <em>not</em> the author of any particular plan.
     *
     * <h2>Why this is site-level and not plan-level</h2>
     *
     * "Which supervisor is responsible for this AI-drafted plan?" has no answer in the data for
     * most plans. Neither {@code shift} nor {@code recommendation} records a creator, and since
     * SCRUM-291 the majority are drafted by the scheduler — {@code generateAuto} passes a null
     * actor precisely because there is no human to name. The audit log holds the drafter for the
     * manually-triggered ones, and nothing at all for the rest.
     *
     * <p>So this answers the question that does have an answer: who is accountable for work at
     * this site. It is true for every plan regardless of status or origin, which is what the
     * oversight list needs, but it must never be labelled as authorship — a machine-drafted plan
     * attributed to a named person is a false record on a screen §12.2 exists to make traceable.
     * The client's copy carries that distinction; see {@code oversight.supervisorLabel}.
     */
    public record SiteSupervisor(UUID id, String displayName) {
    }

    /**
     * @param awaitingDecision plans no supervisor has decided on — the only figure that asks
     *                         for action, and what the list sorts by
     * @param totalPlans       every plan ever drafted for the site, decided or not
     * @param supervisors      the site's active supervisors, so the oversight list can label
     *                         every plan with who is accountable for it
     */
    public record SitePlanSummary(UUID siteId, long awaitingDecision, long totalPlans,
                                   List<SiteSupervisor> supervisors) {
    }

    /**
     * Counts plans per site for every site the caller belongs to.
     *
     * <p>Open to supervisors as well as managers: the figures are about sites the caller
     * already has full read access to, so withholding a count would hide something they can
     * see by expanding the row anyway.
     *
     * <p>A site with no plans is returned with zeroes rather than omitted. The repository's
     * {@code GROUP BY} cannot produce a row for a site that has none, and leaving those out
     * would make the client responsible for knowing that absent means zero — a small rule that
     * is easy to get wrong once and then wrong everywhere.
     *
     * <p>Empty for a caller with no memberships, which includes an ADMIN who has not been added
     * to any site. That matches {@code GET /me}, whose {@code siteIds} drives the same screen —
     * the two must agree, or the list and its counts would describe different sets of sites.
     */
    @GetMapping("/plan-summary")
    @PreAuthorize("hasAnyRole('SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN')")
    public ResponseEntity<List<SitePlanSummary>> planSummary(
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        List<UUID> siteIds = memberships.findSiteIdsByUserId(principal.getId());
        if (siteIds.isEmpty()) {
            return ResponseEntity.ok(List.of());
        }

        var counted = recommendations.countPlansBySite(siteIds).stream()
                .collect(java.util.stream.Collectors.toMap(
                        RecommendationRepository.SitePlanCounts::getSiteId,
                        counts -> counts));

        // One query for every site's supervisors, for the same reason the counts are one query.
        var supervisorsBySite = users
                .findBySiteIdsAndRoleAndStatus(siteIds, Role.SUPERVISOR, UserStatus.ACTIVE)
                .stream()
                .collect(java.util.stream.Collectors.groupingBy(
                        AppUserRepository.SiteUser::getSiteId,
                        java.util.stream.Collectors.mapping(
                                row -> new SiteSupervisor(row.getUserId(), row.getDisplayName()),
                                java.util.stream.Collectors.toList())));

        return ResponseEntity.ok(siteIds.stream()
                .map(siteId -> {
                    var counts = counted.get(siteId);
                    var supervisors = supervisorsBySite.getOrDefault(siteId, List.of());
                    return counts == null
                            ? new SitePlanSummary(siteId, 0, 0, supervisors)
                            : new SitePlanSummary(siteId, counts.getAwaitingDecision(),
                                    counts.getTotalPlans(), supervisors);
                })
                .toList());
    }
}
