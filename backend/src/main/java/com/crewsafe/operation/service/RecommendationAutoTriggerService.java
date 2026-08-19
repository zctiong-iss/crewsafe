package com.crewsafe.operation.service;

import com.crewsafe.lightning.api.LightningRiskPayload;
import com.crewsafe.lightning.domain.LightningRiskState;
import com.crewsafe.lightning.risk.LightningRiskDerivationService;
import com.crewsafe.operation.config.RecommendationAutoTriggerProperties;
import com.crewsafe.operation.domain.SiteConditionState;
import com.crewsafe.operation.repository.SiteConditionStateRepository;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WbgtBand;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.service.WeatherQueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Evaluates every site for a WBGT band or lightning risk-state transition and auto-triggers a
 * draft on each eligible shift when one is found (SCRUM-291), the way {@code ActionDispatchService
 * #markLateDispatches} evaluates every candidate dispatch on a schedule rather than per-request.
 *
 * <h2>Why nothing here shares a transaction with {@link AgentDraftService#generateAuto}</h2>
 *
 * A missing policy or an unusable reading is a routine, expected outcome for one shift among
 * many — not this run's problem to abort over. {@code AgentDraftTransactionIntegrationTest}
 * already documents a live incident where letting an expected, handled exception cross a
 * {@code @Transactional} proxy boundary marked the wrong transaction rollback-only regardless of
 * being caught. Every write in this class — the per-site condition state and each shift's draft
 * — is therefore its own independent transaction (state via {@code SiteConditionStateRepository}
 * 's own transactional CRUD, drafts via {@code generateAuto}'s own {@code @Transactional}), so
 * one shift's failure can never roll back another shift's draft or this site's state record.
 *
 * @author Abu Bakar
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RecommendationAutoTriggerService {

    private static final double MIN_USABLE_WBGT = 15;
    private static final double MAX_USABLE_WBGT = 40;

    private final SiteRepository sites;
    private final ShiftRepository shifts;
    private final WeatherQueryService weather;
    private final LightningRiskDerivationService lightning;
    private final SiteConditionStateRepository conditionStates;
    private final AgentDraftService agentDraftService;
    private final RecommendationAutoTriggerProperties properties;
    private final Clock clock;

    /** Evaluates every site once. Returns how many shifts were auto-triggered this run. */
    public int evaluateAllSites() {
        Instant now = clock.instant();
        int triggeredCount = 0;
        for (Site site : sites.findAll()) {
            try {
                triggeredCount += evaluateSite(site.getId(), now);
            } catch (RuntimeException e) {
                // One site's weather/lightning read failing must not stop the rest from being
                // evaluated this tick — same reasoning as the per-shift catch in triggerShift.
                log.warn("recommendation_auto_trigger_site_evaluation_failed site_id={} reason={}",
                        site.getId(), e.getMessage());
            }
        }
        return triggeredCount;
    }

    private int evaluateSite(UUID siteId, Instant now) {
        WbgtBand currentBand = currentBand(siteId);
        LightningRiskState currentLightningState = currentLightningState(siteId, now);

        Transition transition = recordEvaluation(siteId, currentBand, currentLightningState, now);
        if (!transition.any()) {
            return 0;
        }
        if (!transition.lightningChanged() && currentLightningState == LightningRiskState.STOP_WORK) {
            // Band moved while lightning stop-work is still in force. Stop-work already takes
            // precedence over any band-driven plan, so drafting one here would just be redundant
            // noise -- and, worse, another round of duplicate dispatches to a crew already told
            // to stop.
            log.info("recommendation_auto_trigger_skipped_band_change_during_stop_work site_id={}", siteId);
            return 0;
        }

        int triggeredCount = 0;
        Instant leadWindowCutoff = now.plus(properties.getLeadWindow());
        for (Shift shift : shifts.findEligibleForAutoTrigger(siteId, now, leadWindowCutoff)) {
            if (triggerShift(siteId, shift.getId())) {
                triggeredCount++;
            }
        }
        return triggeredCount;
    }

    /** Which of a site's tracked conditions changed since the last evaluation. */
    private record Transition(boolean bandChanged, boolean lightningChanged) {
        boolean any() {
            return bandChanged || lightningChanged;
        }
    }

    /**
     * Upserts this site's condition-state row and reports which conditions are a genuine
     * transition from the last evaluation recorded. Null is a real, comparable value on both
     * sides — a site's first-ever reading arriving is itself a transition, but a site with no
     * prior row at all has nothing to transition <em>from</em>, so the very first evaluation
     * always seeds the row without reporting a transition, deliberately: without this, every site
     * would fire once the moment the scheduler is first enabled, which is noise, not a real
     * change in conditions.
     */
    private Transition recordEvaluation(UUID siteId, WbgtBand currentBand, LightningRiskState currentLightningState,
                                         Instant now) {
        Optional<SiteConditionState> existing = conditionStates.findById(siteId);
        boolean bandChanged = existing.isPresent()
                && !Objects.equals(existing.get().getLastWbgtBand(), currentBand);
        boolean lightningChanged = existing.isPresent()
                && !Objects.equals(existing.get().getLastLightningState(), currentLightningState);

        SiteConditionState state = existing.orElseGet(
                () -> new SiteConditionState(siteId, currentBand, currentLightningState, now));
        state.setLastWbgtBand(currentBand);
        state.setLastLightningState(currentLightningState);
        state.setLastEvaluatedAt(now);
        conditionStates.save(state);

        return new Transition(bandChanged, lightningChanged);
    }

    private boolean triggerShift(UUID siteId, UUID shiftId) {
        try {
            agentDraftService.generateAuto(siteId, shiftId);
            return true;
        } catch (RuntimeException e) {
            // Expected, routine outcomes for one shift among many -- no usable reading, no
            // active policy configured yet -- must not stop the rest of this site's eligible
            // shifts, or the next site, from being evaluated.
            log.warn("recommendation_auto_trigger_shift_failed site_id={} shift_id={} reason={}",
                    siteId, shiftId, e.getMessage());
            return false;
        }
    }

    /**
     * Filters out sensor-fault readings the same way {@code AgentDraftService#usableWbgt}
     * does, so a fault is never misread as a genuine band transition.
     */
    private WbgtBand currentBand(UUID siteId) {
        return weather.findLatestForSite(siteId)
                .map(WeatherQueryService.LatestSiteWeather::observation)
                .map(WeatherObservation::getWbgt)
                .filter(wbgt -> wbgt.doubleValue() >= MIN_USABLE_WBGT && wbgt.doubleValue() <= MAX_USABLE_WBGT)
                .map(WbgtBand::classify)
                .orElse(null);
    }

    private LightningRiskState currentLightningState(UUID siteId, Instant now) {
        return lightning.deriveForSite(siteId, now)
                .map(LightningRiskPayload::state)
                .orElse(null);
    }
}
