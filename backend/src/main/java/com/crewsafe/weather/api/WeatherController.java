package com.crewsafe.weather.api;

import com.crewsafe.weather.domain.WbgtBand;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.domain.WeatherQualityStatus;
import com.crewsafe.weather.domain.WeatherSource;
import com.crewsafe.weather.service.WeatherQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Site-scoped weather readings consumed by the live board.
 *
 * @author Justin Chua
 */
@RestController
@RequestMapping("/api/v1/sites/{siteId}/weather")
@RequiredArgsConstructor
public class WeatherController {

    private final WeatherQueryService weatherQueries;

    /**
     * Returns stored data instead of calling data.gov.sg during an HTTP request. This keeps
     * the dashboard fast and ensures every user sees the same validated site snapshot.
     */
    @GetMapping("/latest")
    @PreAuthorize("@siteAccess.canAccess(#siteId)")
    public ResponseEntity<LatestWeatherResponse> getLatestWeather(@PathVariable UUID siteId) {
        return weatherQueries.findLatestForSite(siteId)
                .map(LatestWeatherResponse::from)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    public record LatestWeatherResponse(
            UUID id,
            UUID siteId,
            BigDecimal wbgt,
            BigDecimal temperature,
            BigDecimal humidity,
            BigDecimal windSpeed,
            BigDecimal rainfall,
            Instant observedAt,
            Instant ingestedAt,
            WeatherSource source,
            WeatherQualityStatus qualityStatus,
            String stationId,
            /*
             * Evaluated server-side and returned with the reading (SCRUM-209).
             *
             * Clients render this; they never derive it. Section 12.2 forbids a client
             * submitting or overriding a WBGT band, and FR-15 makes the backend engine
             * authoritative for anything deciding what a worker must do. Shipping the band
             * beside the number it comes from is what lets a client show both without
             * computing either.
             *
             * Null when `wbgt` is null - see WbgtBand.classify for why that is not defaulted
             * to the coolest band.
             */
            WbgtBand band) {

        static LatestWeatherResponse from(WeatherQueryService.LatestSiteWeather latest) {
            WeatherObservation observation = latest.observation();
            return new LatestWeatherResponse(
                    observation.getId(),
                    observation.getSiteId(),
                    observation.getWbgt(),
                    observation.getTemperature(),
                    observation.getHumidity(),
                    observation.getWindSpeed(),
                    observation.getRainfall(),
                    observation.getObservedAt(),
                    observation.getIngestedAt(),
                    observation.getSource(),
                    latest.qualityStatus(),
                    observation.getStationId(),
                    WbgtBand.classify(observation.getWbgt()));
        }
    }
}
