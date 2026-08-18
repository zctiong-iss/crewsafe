package com.crewsafe.weather.api;

import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.weather.domain.WbgtBand;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.service.WeatherQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One reading per site, across everything the caller oversees.
 *
 * <h2>Why this is not site-scoped</h2>
 *
 * {@code /sites/{siteId}/weather/latest} answers "how is this site?", and the weather screen
 * asked it once for whichever site was selected. That was fine while a site list was a handful
 * of radio buttons. A safety manager may hold twenty memberships, and the question they actually
 * have is "which of my sites is hottest?" — twenty round trips to answer, on a phone, outdoors.
 *
 * <p>The scope comes from the caller's own memberships, read server-side from the same
 * {@link SiteMembershipRepository#findSiteIdsByUserId} that backs {@code GET /me}, so there is no
 * {@code siteId} to widen and nothing to check per site. Same shape and same reasoning as
 * {@code OversightController}'s plan summary.
 *
 * <h2>The band comes evaluated, as everywhere else</h2>
 *
 * §12.2 forbids a client deciding what a WBGT number means, and a list of twenty numbers is
 * exactly where a client would be tempted to colour them itself. Each row carries the band the
 * server classified, so the picker can colour and label without computing anything.
 *
 * @author Justin Chua
 */
@RestController
@RequestMapping("/api/v1/weather")
@RequiredArgsConstructor
public class SiteWeatherSummaryController {

    private final WeatherQueryService weatherQueries;
    private final SiteMembershipRepository memberships;

    /**
     * @param wbgt  null when the site has no reading, or one whose WBGT could not be derived.
     *              Rendered as "no reading" rather than as a cool one — see {@link WbgtBand}.
     * @param band  null exactly when {@code wbgt} is, never defaulted to the coolest band
     * @param freshness live/delayed/stale evaluated now, not when the row was written, so a
     *              LIVE reading from forty minutes ago reports as STALE
     */
    public record SiteWeatherSummary(UUID siteId, BigDecimal wbgt, WbgtBand band,
                                      Instant observedAt, WeatherQualityStatus freshness) {
    }

    /**
     * Latest conditions for every site the caller belongs to.
     *
     * <p>A site with no stored reading is returned with nulls rather than omitted. The caller
     * knows which sites it oversees, and a missing row would be indistinguishable from a site
     * that quietly dropped out of the list — on a screen whose job is comparing sites, an absent
     * one is worse than one that says it has no data.
     *
     * <p>Empty for a caller with no memberships, matching {@code GET /me}, whose {@code siteIds}
     * drives the same screen.
     */
    @GetMapping("/site-summary")
    @PreAuthorize("hasAnyRole('WORKER', 'SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN')")
    public ResponseEntity<List<SiteWeatherSummary>> siteSummary(
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        return ResponseEntity.ok(memberships.findSiteIdsByUserId(principal.getId()).stream()
                .map(siteId -> weatherQueries.findLatestForSite(siteId)
                        .map(latest -> new SiteWeatherSummary(
                                siteId,
                                latest.observation().getWbgt(),
                                WbgtBand.classify(latest.observation().getWbgt()),
                                latest.observation().getObservedAt(),
                                latest.qualityStatus()))
                        .orElseGet(() -> new SiteWeatherSummary(siteId, null, null, null, null)))
                .toList());
    }
}
