package com.crewsafe.forecast.service;

import com.crewsafe.forecast.client.ForecastApiClient;
import com.crewsafe.forecast.client.ForecastApiClient.ForecastApiRequest;
import com.crewsafe.forecast.client.ForecastApiClient.ForecastApiResponse;
import com.crewsafe.forecast.client.ForecastApiClient.ForecastContext;
import com.crewsafe.forecast.client.ForecastApiClient.ForecastObservation;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Produces a WBGT forecast for a site, degrading through progressively weaker methods rather
 * than refusing when conditions are imperfect.
 *
 * <h2>What changed and why</h2>
 *
 * This service used to have exactly one path: build a two-hour context on an exact 15-minute
 * cadence from a single station, or throw. Every one of its preconditions was reasonable on its
 * own, and together they made a forecast nearly unreachable against real NEA delivery — readings
 * arrive around 19 minutes late, ingestion polls every 15 minutes, and the age ceiling was 45
 * minutes, leaving roughly 11 minutes of margin. Worse, the cadence check compared durations
 * with {@code equals}, so one missing reading disqualified a window two hours wide: a single
 * dropped cycle removed forecasting for the next two hours, not for one tick.
 *
 * <p>Now the preconditions select a {@link ForecastBasis} instead of deciding whether to answer.
 * Clean context uses the model. Context with a few holes is repaired and still uses the model.
 * No usable context at all falls to a damped trend over whatever real observations exist, then
 * to carrying the last reading forward. Only a site with nothing inside
 * {@link #OBSERVATION_CEILING} produces no forecast, which is the one case where silence is the
 * honest answer.
 *
 * <h2>Degradation is stated, never hidden</h2>
 *
 * §7.1 says a degraded input degrades the output; it does not say the output may quietly look
 * as confident as a fresh one. Every rung below {@link ForecastBasis#MODEL} widens its
 * confidence interval with the age of its newest input and with how much was inferred, and
 * reports {@code basis} and {@code inputAgeMinutes} so the client can label it. A wide interval
 * shown as wide is a usable warning; a narrow interval on stale data is a lie.
 *
 * @author Justin Chua
 */
@Service
@RequiredArgsConstructor
@Slf4j
// REQUIRES_NEW, not the default REQUIRED: AgentDraftService calls this from inside its own
// @Transactional write. Without its own transaction, a ForecastUnavailableException thrown
// here - an ordinary, expected outcome (§7.1) that AgentDraftService already catches and
// degrades to null - joins and poisons that outer transaction anyway: Spring's interceptor
// marks the shared transaction rollback-only the moment the exception crosses this proxy
// boundary, before the caller's catch block ever runs. The draft would still appear to
// succeed (the code keeps running, logs success) right up until the outer commit, which
// then throws UnexpectedRollbackException and silently discards the whole recommendation -
// a caught, handled exception silently losing a write nowhere near it. Its own transaction
// means a forecast failure can only roll back its own read, never the draft it's part of.
@Transactional(readOnly = true, propagation = Propagation.REQUIRES_NEW)
public class SiteForecastService {

    /** How far back the model's context may reach from its newest reading. */
    private static final Duration CONTEXT_HISTORY = Duration.ofHours(2);

    /** The grid the trained model was built around. Context is resampled onto it. */
    private static final Duration CADENCE = Duration.ofMinutes(15);

    /**
     * How far an observation's timestamp may sit from a grid slot and still be treated as that
     * slot's reading. Half a cadence, so every timestamp maps to exactly one nearest slot.
     */
    private static final Duration SNAP_TOLERANCE = CADENCE.dividedBy(2);

    /**
     * The model is not asked to predict from context whose newest reading is older than this.
     * Matches ml-service's own limit; beyond it the model would refuse anyway, and the trend
     * tier gives a better answer than a rejected call.
     */
    private static final Duration MODEL_INPUT_MAX_AGE = Duration.ofMinutes(45);

    /**
     * Interpolated slots tolerated before the model tier is abandoned for the trend tier.
     *
     * <p>Two is deliberately small. Interpolation invents inputs the model then treats as
     * measurements, so a context mostly made of guesses produces a confident-looking prediction
     * about data that was never observed — worse than an openly weaker method.
     */
    private static final int MAX_IMPUTED_SLOTS = 2;

    /** The trend tier needs at least two real readings inside this window to fit a slope. */
    private static final Duration TREND_WINDOW = Duration.ofMinutes(90);

    /** Nothing newer than this means no forecast at all — the one honest silence. */
    private static final Duration OBSERVATION_CEILING = Duration.ofHours(3);

    /** Readings outside this band are sensor faults rather than weather. */
    private static final BigDecimal MIN_PLAUSIBLE_WBGT = new BigDecimal("15");
    private static final BigDecimal MAX_PLAUSIBLE_WBGT = new BigDecimal("40");

    /** Beyond this age, the interval starts widening. Roughly one delivery cycle. */
    private static final Duration FRESH_FOR = Duration.ofMinutes(20);

    /** Interval growth per half-hour of staleness beyond {@link #FRESH_FOR}. */
    private static final double AGE_WIDENING_PER_30_MIN = 0.35;

    /** No forecast claims to be tighter than this, whatever the method says. */
    private static final BigDecimal MIN_HALF_WIDTH = new BigDecimal("0.30");

    /**
     * Past this, the range spans more than a WBGT band and carries no actionable information,
     * so saying nothing is more honest than saying "somewhere between two different answers".
     */
    private static final BigDecimal MAX_USEFUL_HALF_WIDTH = new BigDecimal("4.00");

    private static final String TREND_MODEL_VERSION = "trend-damped-1.0.0";
    private static final String PERSISTENCE_MODEL_VERSION = "persistence-1.0.0";

    private final SiteRepository sites;
    private final WeatherObservationRepository weatherObservations;
    private final ForecastApiClient forecastClient;
    private final Clock clock;

    /**
     * @return empty only when no such site exists; every other outcome is a forecast
     * @throws ForecastUnavailableException when the site has no usable reading inside
     *         {@link #OBSERVATION_CEILING}
     */
    public Optional<SiteForecast> forecast(UUID siteId, int horizonMinutes) {
        validateHorizon(horizonMinutes);
        Optional<Site> site = sites.findById(siteId);
        if (site.isEmpty()) {
            return Optional.empty();
        }

        Instant now = clock.instant();
        List<WeatherObservation> usable = usableNewestFirst(siteId);
        if (usable.isEmpty()) {
            throw new ForecastUnavailableException("No usable weather exists for this site");
        }

        WeatherObservation latest = usable.getFirst();
        Duration inputAge = Duration.between(latest.getObservedAt(), now);
        if (inputAge.compareTo(OBSERVATION_CEILING) > 0) {
            throw new ForecastUnavailableException(
                    "The newest weather reading is too old to forecast from");
        }

        SiteForecast forecast = modelForecast(site.get(), usable, latest, horizonMinutes, inputAge)
                .or(() -> trendForecast(usable, latest, horizonMinutes, inputAge, now))
                .orElseGet(() -> persistenceForecast(latest, horizonMinutes, inputAge));

        // Widening is applied by each tier, but the ceiling is enforced once, here, so no tier
        // can return a range too wide to mean anything by claiming it is still "a forecast".
        if (halfWidthOf(forecast).compareTo(MAX_USEFUL_HALF_WIDTH) > 0) {
            throw new ForecastUnavailableException(
                    "Available weather is too sparse to forecast with useful confidence");
        }

        log.info("site_forecast_produced site_id={} basis={} horizon={} input_age_min={}",
                siteId, forecast.basis(), horizonMinutes, forecast.inputAgeMinutes());
        return Optional.of(forecast);
    }

    /**
     * Newest first, keeping only rows that could carry a forecast: a WBGT inside the plausible
     * band, and not simulated. A simulated reading is demo data and must never reach a
     * prediction a supervisor might act on.
     */
    private List<WeatherObservation> usableNewestFirst(UUID siteId) {
        return weatherObservations.findTop24BySiteIdOrderByObservedAtDesc(siteId).stream()
                .filter(row -> row.getWbgt() != null)
                .filter(row -> row.getQualityStatus() != WeatherQualityStatus.SIMULATED)
                .filter(row -> row.getWbgt().compareTo(MIN_PLAUSIBLE_WBGT) >= 0
                        && row.getWbgt().compareTo(MAX_PLAUSIBLE_WBGT) <= 0)
                .toList();
    }

    // ── Tier 1 and 2: the trained model, on clean or repaired context ───────────────────────

    private Optional<SiteForecast> modelForecast(Site site, List<WeatherObservation> usable,
                                                  WeatherObservation latest, int horizonMinutes,
                                                  Duration inputAge) {
        if (inputAge.compareTo(MODEL_INPUT_MAX_AGE) > 0) {
            return Optional.empty();
        }
        String stationId = latest.getStationId();
        if (stationId == null || stationId.isBlank()) {
            return Optional.empty();
        }

        Optional<ResampledContext> resampled = resample(usable, stationId, latest);
        if (resampled.isEmpty()) {
            return Optional.empty();
        }
        ResampledContext context = resampled.get();

        try {
            ForecastApiResponse response = forecastClient.forecast(ForecastApiRequest.wbgt(
                    horizonMinutes,
                    latest.getWbgt(),
                    new ForecastContext(stationId, site.getLatitude(), site.getLongitude(),
                            context.observations())));

            ForecastBasis basis = context.imputedSlots() == 0
                    ? ForecastBasis.MODEL
                    : ForecastBasis.MODEL_IMPUTED;
            return Optional.of(fromApi(response, basis, inputAge, context.imputedSlots()));

        } catch (RuntimeException e) {
            // ml-service unreachable, or it rejected the context for a reason this side did not
            // anticipate. Either way the lower tiers still have real observations to work from,
            // so this degrades rather than failing the request.
            log.warn("forecast_model_tier_unavailable station_id={} falling back to trend", stationId);
            return Optional.empty();
        }
    }

    /**
     * Builds the model's input grid rather than asserting the data already is one.
     *
     * <p>The old check compared each spacing to fifteen minutes with {@link Duration#equals},
     * exact to the nanosecond, against timestamps nothing guaranteed were gridded. Here each
     * reading is snapped to its nearest slot, single gaps are interpolated, and the result is
     * accepted or rejected on how much had to be invented.
     *
     * @return empty when the context cannot be assembled well enough to ask the model
     */
    private Optional<ResampledContext> resample(List<WeatherObservation> usable, String stationId,
                                                 WeatherObservation latest) {
        Instant newestSlot = snap(latest.getObservedAt());
        Instant oldestAllowed = newestSlot.minus(CONTEXT_HISTORY);

        // One station only. A mid-window station change is a different sensor in a different
        // place, and splicing the two would hand the model a discontinuity it would read as
        // weather.
        Map<Instant, WeatherObservation> bySlot = new LinkedHashMap<>();
        for (WeatherObservation row : usable) {
            if (!stationId.equals(row.getStationId())) {
                continue;
            }
            Instant slot = snap(row.getObservedAt());
            if (slot.isAfter(newestSlot) || slot.isBefore(oldestAllowed)) {
                continue;
            }
            if (Duration.between(row.getObservedAt(), slot).abs().compareTo(SNAP_TOLERANCE) > 0) {
                continue;
            }
            // Newest first, so the first row to claim a slot is the freshest for it.
            bySlot.putIfAbsent(slot, row);
        }

        if (!bySlot.containsKey(newestSlot) || bySlot.size() < 2) {
            return Optional.empty();
        }

        Instant oldestSlot = bySlot.keySet().stream().min(Instant::compareTo).orElseThrow();
        List<ForecastObservation> observations = new ArrayList<>();
        int imputed = 0;

        for (Instant slot = oldestSlot; !slot.isAfter(newestSlot); slot = slot.plus(CADENCE)) {
            WeatherObservation row = bySlot.get(slot);
            if (row != null) {
                observations.add(toForecastObservation(row, slot));
                continue;
            }
            Optional<BigDecimal> interpolated = interpolateAt(bySlot, slot, oldestSlot, newestSlot);
            if (interpolated.isEmpty() || ++imputed > MAX_IMPUTED_SLOTS) {
                return Optional.empty();
            }
            // Only WBGT is interpolated. The auxiliary channels are left null rather than
            // invented: the model tolerates missing ones, and a fabricated humidity is a worse
            // input than an absent one.
            observations.add(new ForecastObservation(slot, interpolated.get(),
                    null, null, null, null, null));
        }

        if (observations.size() < 2) {
            return Optional.empty();
        }
        return Optional.of(new ResampledContext(observations, imputed));
    }

    /** Linear interpolation between the nearest real readings on either side of a gap. */
    private Optional<BigDecimal> interpolateAt(Map<Instant, WeatherObservation> bySlot, Instant slot,
                                                Instant oldestSlot, Instant newestSlot) {
        Instant before = null;
        for (Instant candidate = slot.minus(CADENCE); !candidate.isBefore(oldestSlot);
                candidate = candidate.minus(CADENCE)) {
            if (bySlot.containsKey(candidate)) {
                before = candidate;
                break;
            }
        }
        Instant after = null;
        for (Instant candidate = slot.plus(CADENCE); !candidate.isAfter(newestSlot);
                candidate = candidate.plus(CADENCE)) {
            if (bySlot.containsKey(candidate)) {
                after = candidate;
                break;
            }
        }
        if (before == null || after == null) {
            return Optional.empty();
        }

        BigDecimal startValue = bySlot.get(before).getWbgt();
        BigDecimal endValue = bySlot.get(after).getWbgt();
        double span = Duration.between(before, after).toSeconds();
        double offset = Duration.between(before, slot).toSeconds();
        BigDecimal fraction = BigDecimal.valueOf(offset / span);
        return Optional.of(startValue.add(endValue.subtract(startValue).multiply(fraction))
                .setScale(2, RoundingMode.HALF_UP));
    }

    // ── Tier 3: damped linear trend ─────────────────────────────────────────────────────────

    /**
     * Extrapolates recent real readings, damped so a steep short-run slope cannot run away.
     *
     * <p>An undamped fit on noisy sensor data routinely projects several degrees in an hour,
     * which is not weather, it is the fit chasing noise. The damping factor holds the projection
     * near the observations while still expressing direction, and the result is clipped to the
     * plausible band so no arithmetic can produce a WBGT the rest of the system would reject.
     */
    private Optional<SiteForecast> trendForecast(List<WeatherObservation> usable,
                                                  WeatherObservation latest, int horizonMinutes,
                                                  Duration inputAge, Instant now) {
        Instant windowStart = now.minus(TREND_WINDOW);
        List<WeatherObservation> window = usable.stream()
                .filter(row -> !row.getObservedAt().isBefore(windowStart))
                .toList();
        if (window.size() < 2) {
            return Optional.empty();
        }

        WeatherObservation oldest = window.getLast();
        double elapsedMinutes = Duration.between(oldest.getObservedAt(), latest.getObservedAt())
                .toSeconds() / 60.0;
        if (elapsedMinutes <= 0) {
            return Optional.empty();
        }

        double slopePerMinute =
                latest.getWbgt().subtract(oldest.getWbgt()).doubleValue() / elapsedMinutes;

        // Projected from now, not from the last reading: with a 25-minute-old observation a
        // "30-minute forecast" anchored to that reading actually lands 5 minutes from now while
        // being labelled 30. The effective horizon carries the input's age.
        double effectiveHorizon = horizonMinutes + inputAge.toSeconds() / 60.0;
        double damping = TREND_WINDOW.toMinutes()
                / (TREND_WINDOW.toMinutes() + effectiveHorizon);

        double projectedDelta = slopePerMinute * effectiveHorizon * damping;
        BigDecimal projected = latest.getWbgt()
                .add(BigDecimal.valueOf(projectedDelta))
                .setScale(2, RoundingMode.HALF_UP);
        BigDecimal predicted = clampToPlausible(projected);

        // Scaled by how far the projection actually moved, not by the raw slope: those differ by
        // the damping factor, and using the raw slope made the interval blow past the usefulness
        // ceiling for rises that are steep but entirely real, refusing exactly the fast-warming
        // conditions a supervisor most needs a forecast for. A genuinely wild slope still
        // exceeds the ceiling and is still refused - that is sensor noise, not weather.
        BigDecimal base = new BigDecimal("0.80").add(BigDecimal.valueOf(Math.abs(projectedDelta)));
        return Optional.of(build(predicted, horizonMinutes, TREND_MODEL_VERSION,
                ForecastBasis.TREND, inputAge, widen(base, inputAge, 0)));
    }

    // ── Tier 4: persistence ─────────────────────────────────────────────────────────────────

    /** The last real reading carried forward — the weakest answer that is still an answer. */
    private SiteForecast persistenceForecast(WeatherObservation latest, int horizonMinutes,
                                              Duration inputAge) {
        BigDecimal base = new BigDecimal("1.20");
        return build(latest.getWbgt(), horizonMinutes, PERSISTENCE_MODEL_VERSION,
                ForecastBasis.PERSISTENCE, inputAge, widen(base, inputAge, 0));
    }

    // ── Confidence ──────────────────────────────────────────────────────────────────────────

    /**
     * Grows a half-width with the age of the newest input and with how many slots were invented.
     *
     * <p>This is what keeps the ladder honest. A fallback that kept the model's native interval
     * would claim a precision it does not have, and a supervisor reading a tight range around a
     * two-hour-old reading is worse off than one reading no forecast at all.
     */
    private static BigDecimal widen(BigDecimal base, Duration inputAge, int imputedSlots) {
        double staleMinutes = Math.max(0, inputAge.toSeconds() / 60.0 - FRESH_FOR.toMinutes());
        double ageFactor = 1 + AGE_WIDENING_PER_30_MIN * (staleMinutes / 30.0);
        double imputationFactor = 1 + 0.15 * imputedSlots;
        BigDecimal widened = base
                .multiply(BigDecimal.valueOf(ageFactor))
                .multiply(BigDecimal.valueOf(imputationFactor))
                .setScale(2, RoundingMode.HALF_UP);
        return widened.max(MIN_HALF_WIDTH);
    }

    private static BigDecimal halfWidthOf(SiteForecast forecast) {
        return forecast.confidenceIntervalUpper()
                .subtract(forecast.confidenceIntervalLower())
                .divide(BigDecimal.valueOf(2), 2, RoundingMode.HALF_UP);
    }

    private static BigDecimal clampToPlausible(BigDecimal value) {
        return value.max(MIN_PLAUSIBLE_WBGT).min(MAX_PLAUSIBLE_WBGT);
    }

    // ── Assembly ────────────────────────────────────────────────────────────────────────────

    private static SiteForecast build(BigDecimal predicted, int horizonMinutes, String modelVersion,
                                       ForecastBasis basis, Duration inputAge, BigDecimal halfWidth) {
        return new SiteForecast(
                "wbgt",
                predicted,
                horizonMinutes,
                modelVersion,
                predicted.subtract(halfWidth),
                predicted.add(halfWidth),
                Instant.now(),
                basis,
                inputAge.toMinutes(),
                basis != ForecastBasis.MODEL);
    }

    private SiteForecast fromApi(ForecastApiResponse response, ForecastBasis basis,
                                  Duration inputAge, int imputedSlots) {
        BigDecimal predicted = response.predictedValue();
        BigDecimal nativeHalfWidth = response.confidenceIntervalUpper()
                .subtract(response.confidenceIntervalLower())
                .divide(BigDecimal.valueOf(2), 2, RoundingMode.HALF_UP);

        // A clean model result keeps exactly the interval the model reported, so this cannot
        // regress the good path. Only an imputed one is widened.
        BigDecimal halfWidth = basis == ForecastBasis.MODEL
                ? nativeHalfWidth.max(MIN_HALF_WIDTH)
                : widen(nativeHalfWidth, inputAge, imputedSlots);

        return new SiteForecast(
                response.metric(),
                predicted,
                response.horizonMinutes(),
                response.modelVersion(),
                predicted.subtract(halfWidth),
                predicted.add(halfWidth),
                response.timestamp(),
                basis,
                inputAge.toMinutes(),
                basis != ForecastBasis.MODEL);
    }

    private static ForecastObservation toForecastObservation(WeatherObservation observation,
                                                              Instant slot) {
        return new ForecastObservation(
                // The snapped slot, not the raw timestamp: ml-service validates alignment to the
                // 15-minute grid, and the raw value is what used to fail that check.
                slot,
                observation.getWbgt(),
                observation.getTemperature(),
                observation.getHumidity(),
                observation.getWindSpeed(),
                null,
                observation.getRainfall());
    }

    /** Rounds to the nearest 15-minute boundary. */
    private static Instant snap(Instant timestamp) {
        long cadenceSeconds = CADENCE.toSeconds();
        long epochSecond = timestamp.getEpochSecond();
        long remainder = Math.floorMod(epochSecond, cadenceSeconds);
        long base = epochSecond - remainder;
        return Instant.ofEpochSecond(remainder * 2 >= cadenceSeconds ? base + cadenceSeconds : base);
    }

    private static void validateHorizon(int horizonMinutes) {
        if (horizonMinutes != 30 && horizonMinutes != 60) {
            throw new IllegalArgumentException("horizonMinutes must be 30 or 60");
        }
    }

    /** The model's input grid, plus how much of it had to be inferred. */
    private record ResampledContext(List<ForecastObservation> observations, int imputedSlots) {
    }

    /**
     * Site-authorized response; the underlying ML service remains private.
     *
     * <p>{@code basis}, {@code inputAgeMinutes} and {@code degraded} are additive: a client that
     * predates them ignores them and behaves exactly as before. A client that reads them must
     * label anything other than {@link ForecastBasis#MODEL}, because the number alone does not
     * say how much to trust it.
     */
    public record SiteForecast(
            String metric,
            BigDecimal predictedValue,
            int horizonMinutes,
            String modelVersion,
            BigDecimal confidenceIntervalLower,
            BigDecimal confidenceIntervalUpper,
            Instant generatedAt,
            ForecastBasis basis,
            long inputAgeMinutes,
            boolean degraded) {
    }
}
