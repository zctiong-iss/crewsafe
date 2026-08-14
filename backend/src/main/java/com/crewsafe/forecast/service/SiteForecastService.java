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
import com.crewsafe.weather.ingestion.WeatherFreshnessClassifier;
import com.crewsafe.weather.repository.WeatherObservationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Builds validated recent context and calls the private trained-model service. */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class SiteForecastService {

    private static final Duration CONTEXT_HISTORY = Duration.ofHours(2);

    private final SiteRepository sites;
    private final WeatherObservationRepository weatherObservations;
    private final ForecastApiClient forecastClient;
    private final WeatherFreshnessClassifier freshnessClassifier;
    private final Clock clock;

    public Optional<SiteForecast> forecast(UUID siteId, int horizonMinutes) {
        validateHorizon(horizonMinutes);
        Optional<Site> site = sites.findById(siteId);
        if (site.isEmpty()) {
            return Optional.empty();
        }

        List<WeatherObservation> newestFirst =
                weatherObservations.findTop9BySiteIdOrderByObservedAtDesc(siteId);
        if (newestFirst.isEmpty()) {
            throw new ForecastUnavailableException("No recent weather exists for this site");
        }

        WeatherObservation latest = newestFirst.getFirst();
        if (latest.getWbgt() == null) {
            throw new ForecastUnavailableException("The latest weather row has no WBGT");
        }
        ForecastContext context = buildContext(site.get(), newestFirst);
        ForecastApiResponse response = forecastClient.forecast(ForecastApiRequest.wbgt(
                horizonMinutes,
                latest.getWbgt(),
                context));
        return Optional.of(SiteForecast.fromApi(response));
    }

    private ForecastContext buildContext(
            Site site,
            List<WeatherObservation> newestFirst) {
        if (newestFirst.size() < 2) {
            throw new ForecastUnavailableException("At least two weather rows are required");
        }

        WeatherObservation latest = newestFirst.getFirst();
        String stationId = latest.getStationId();
        if (stationId == null || stationId.isBlank()) {
            throw new ForecastUnavailableException("The latest weather row has no station");
        }
        if (latest.getQualityStatus() == WeatherQualityStatus.SIMULATED
                || freshnessClassifier.classify(latest.getObservedAt(), clock.instant())
                == WeatherQualityStatus.STALE) {
            throw new ForecastUnavailableException("Stale or simulated weather cannot use the model");
        }

        List<WeatherObservation> usable = newestFirst.stream()
                .takeWhile(row -> stationId.equals(row.getStationId()))
                .toList();
        if (usable.size() < 2) {
            throw new ForecastUnavailableException("Recent weather changed station identity");
        }
        Instant oldestAllowed = latest.getObservedAt().minus(CONTEXT_HISTORY);
        List<WeatherObservation> withinWindow = usable.stream()
                .takeWhile(row -> !row.getObservedAt().isBefore(oldestAllowed))
                .toList();
        if (withinWindow.stream()
                .anyMatch(row -> row.getQualityStatus() == WeatherQualityStatus.SIMULATED)) {
            throw new ForecastUnavailableException(
                    "Simulated weather cannot be mixed into trained-model context");
        }

        List<WeatherObservation> oldestFirst = new ArrayList<>(withinWindow);
        Collections.reverse(oldestFirst);
        validateTimestamps(oldestFirst);
        List<ForecastObservation> observations = oldestFirst.stream()
                .map(SiteForecastService::toForecastObservation)
                .toList();
        return new ForecastContext(
                stationId,
                site.getLatitude(),
                site.getLongitude(),
                observations);
    }

    private static void validateTimestamps(List<WeatherObservation> oldestFirst) {
        if (oldestFirst.size() < 2) {
            throw new ForecastUnavailableException("Recent weather context is incomplete");
        }
        for (int index = 1; index < oldestFirst.size(); index++) {
            Duration spacing = Duration.between(
                    oldestFirst.get(index - 1).getObservedAt(),
                    oldestFirst.get(index).getObservedAt());
            if (!spacing.equals(Duration.ofMinutes(15))) {
                throw new ForecastUnavailableException("Recent weather is not on a 15-minute cadence");
            }
        }
    }

    private static ForecastObservation toForecastObservation(WeatherObservation observation) {
        return new ForecastObservation(
                observation.getObservedAt(),
                observation.getWbgt(),
                observation.getTemperature(),
                observation.getHumidity(),
                observation.getWindSpeed(),
                null,
                observation.getRainfall());
    }

    private static void validateHorizon(int horizonMinutes) {
        if (horizonMinutes != 30 && horizonMinutes != 60) {
            throw new IllegalArgumentException("horizonMinutes must be 30 or 60");
        }
    }

    /** Site-authorized response; the underlying ML service remains private. */
    public record SiteForecast(
            String metric,
            BigDecimal predictedValue,
            int horizonMinutes,
            String modelVersion,
            BigDecimal confidenceIntervalLower,
            BigDecimal confidenceIntervalUpper,
            Instant generatedAt) {

        static SiteForecast fromApi(ForecastApiResponse response) {
            return new SiteForecast(
                    response.metric(),
                    response.predictedValue(),
                    response.horizonMinutes(),
                    response.modelVersion(),
                    response.confidenceIntervalLower(),
                    response.confidenceIntervalUpper(),
                    response.timestamp());
        }
    }
}
