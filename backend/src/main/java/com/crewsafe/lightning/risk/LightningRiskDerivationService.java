package com.crewsafe.lightning.risk;

import com.crewsafe.lightning.api.LightningRiskPayload;
import com.crewsafe.lightning.domain.LightningObservation;
import com.crewsafe.lightning.domain.LightningRiskState;
import com.crewsafe.lightning.ingestion.LightningFreshnessClassifier;
import com.crewsafe.lightning.repository.LightningObservationRepository;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Derives a site's current {@link LightningRiskState} from recent {@link LightningObservation}
 * rows rather than storing the state directly — the same "recompute on read" discipline
 * {@code ConditionsSnapshotService} applies to WBGT freshness. A strike that put a site into
 * stop-work ten minutes ago still holds it there now even though the most recent tick alone
 * saw nothing, so every row within the configured validity window is considered, not just
 * the latest one.
 *
 * @author Jemilin Beulah
 */
@Service
@RequiredArgsConstructor
public class LightningRiskDerivationService {

    private final LightningObservationRepository observations;
    private final LightningFreshnessClassifier freshnessClassifier;
    private final LightningRiskProperties properties;

    /** Empty when lightning has never been ingested for this site — distinct from CLEAR. */
    public Optional<LightningRiskPayload> deriveForSite(UUID siteId, Instant asOf) {
        Optional<LightningObservation> latest = observations.findFirstBySiteIdOrderByObservedAtDesc(siteId);
        if (latest.isEmpty()) {
            return Optional.empty();
        }

        WeatherQualityStatus freshness = latest.get().getQualityStatus() == WeatherQualityStatus.SIMULATED
                ? WeatherQualityStatus.SIMULATED
                : freshnessClassifier.classify(latest.get().getObservedAt(), asOf);

        Instant cutoff = asOf.minus(properties.getValidityWindow());
        List<LightningObservation> recent = observations
                .findBySiteIdAndObservedAtGreaterThanEqualOrderByObservedAtDesc(siteId, cutoff);

        return Optional.of(deriveState(recent, latest.get(), cutoff, freshness));
    }

    private LightningRiskPayload deriveState(List<LightningObservation> recent, LightningObservation latest,
                                             Instant cutoff, WeatherQualityStatus freshness) {
        Optional<LightningObservation> stopWork =
                mostRecentQualifyingStrike(recent, properties.getStopWorkRadiusKm(), cutoff);
        if (stopWork.isPresent()) {
            return payload(LightningRiskState.STOP_WORK, stopWork.get(), latest, freshness);
        }

        Optional<LightningObservation> advisory =
                mostRecentQualifyingStrike(recent, properties.getAdvisoryRadiusKm(), cutoff);
        if (advisory.isPresent()) {
            return payload(LightningRiskState.ADVISORY, advisory.get(), latest, freshness);
        }

        // A clear state still carries a validUntil: "assessed clear as of this feed read,
        // re-check after this" — without one the client cannot tell "clear" from "stale and
        // unknown" once the feed itself stops updating.
        return new LightningRiskPayload(LightningRiskState.CLEAR, null, latest.getObservedAt(),
                latest.getObservedAt().plus(properties.getValidityWindow()), freshness);
    }

    private Optional<LightningObservation> mostRecentQualifyingStrike(
            List<LightningObservation> recent, double radiusKm, Instant cutoff) {
        return recent.stream()
                .filter(row -> row.getNearestStrikeKm() != null && row.getNearestStrikeAt() != null
                        && row.getNearestStrikeKm().doubleValue() <= radiusKm
                        && !row.getNearestStrikeAt().isBefore(cutoff))
                .max(Comparator.comparing(LightningObservation::getNearestStrikeAt));
    }

    private LightningRiskPayload payload(LightningRiskState state, LightningObservation qualifying,
                                         LightningObservation latest, WeatherQualityStatus freshness) {
        Instant validUntil = qualifying.getNearestStrikeAt().plus(properties.getValidityWindow());
        return new LightningRiskPayload(state, qualifying.getNearestStrikeKm(),
                latest.getObservedAt(), validUntil, freshness);
    }
}
