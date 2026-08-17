package com.crewsafe.operation.api;

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

    /**
     * @param awaitingDecision plans no supervisor has decided on — the only figure that asks
     *                         for action, and what the list sorts by
     * @param totalPlans       every plan ever drafted for the site, decided or not
     */
    public record SitePlanSummary(UUID siteId, long awaitingDecision, long totalPlans) {
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

        return ResponseEntity.ok(siteIds.stream()
                .map(siteId -> {
                    var counts = counted.get(siteId);
                    return counts == null
                            ? new SitePlanSummary(siteId, 0, 0)
                            : new SitePlanSummary(siteId, counts.getAwaitingDecision(),
                                    counts.getTotalPlans());
                })
                .toList());
    }
}
