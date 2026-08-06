package com.crewsafe.lightning.api;

import com.crewsafe.lightning.risk.LightningRiskDerivationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

/**
 * A site's current lightning risk, for clients that poll rather than stream (SCRUM-261).
 *
 * <p>SCRUM-170 derives this state correctly but publishes it only on {@code ConditionsSnapshot},
 * carried by the conditions SSE stream — which is restricted to supervisors, safety managers and
 * administrators. The mobile stop-work banner lives on the worker's own shift screen, so the one
 * role that needs the state was the one role that could not read it. This endpoint closes that
 * gap without widening the stream.
 *
 * <p>Authorization is site membership and nothing more. That is deliberate rather than an
 * oversight: a worker standing on the site already sees this exact state in the banner, so
 * withholding the reading from them while showing it to a supervisor protects nothing and would
 * leave a crew unable to see why they have been told to shelter.
 *
 * <p>Polled, not streamed, on purpose. The ingestion runs on a two-minute cadence and the app
 * already refreshes the shift screen every sixty seconds, so a long-lived connection would buy
 * no freshness while costing battery on a phone that has to last an outdoor shift.
 *
 * @author Justin Chua
 */
@RestController
@RequestMapping("/api/v1/sites/{siteId}/lightning")
@RequiredArgsConstructor
public class LightningController {

    private final LightningRiskDerivationService riskDerivation;
    private final Clock clock;

    /**
     * Returns 404 when lightning has never been ingested for this site.
     *
     * <p>Emphatically not {@code CLEAR}. "No data" and "no lightning" are the same pixels and
     * opposite meanings on a stop-work surface, and a client that received a cheerful all-clear
     * because the scheduler was switched off would leave a crew outdoors in a storm. The
     * derivation service already models this as an empty {@code Optional}; this preserves that
     * distinction over the wire instead of flattening it into a default.
     */
    @GetMapping
    @PreAuthorize("@siteAccess.canAccess(#siteId)")
    public ResponseEntity<LightningRiskResponse> getLightningRisk(@PathVariable UUID siteId) {
        return riskDerivation.deriveForSite(siteId, clock.instant())
                .map(payload -> LightningRiskResponse.from(siteId, payload))
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * {@link LightningRiskPayload} plus the site it belongs to.
     *
     * <p>The payload omits {@code siteId} because on the SSE stream the enclosing
     * {@code ConditionsSnapshot} already carries it. A standalone response has no such envelope,
     * and the client's own model has always had the field — see {@code mobile/src/types/domain.ts}.
     */
    public record LightningRiskResponse(
            UUID siteId,
            com.crewsafe.lightning.domain.LightningRiskState state,
            BigDecimal nearestStrikeKm,
            Instant observedAt,
            /*
             * When the state expires on its own, independently of whether the feed keeps
             * polling. The client refuses to treat a lapsed assessment as an all-clear, and that
             * only works because the server says when an assessment stops being trustworthy.
             */
            Instant validUntil,
            com.crewsafe.weather.domain.WeatherQualityStatus freshness) {

        static LightningRiskResponse from(UUID siteId, LightningRiskPayload payload) {
            return new LightningRiskResponse(
                    siteId,
                    payload.state(),
                    payload.nearestStrikeKm(),
                    payload.observedAt(),
                    payload.validUntil(),
                    payload.freshness());
        }
    }
}
