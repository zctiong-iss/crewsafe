package com.crewsafe.forecast.client;

import com.crewsafe.forecast.service.ForecastUnavailableException;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** Typed boundary between Spring Boot and the private FastAPI forecast contract. */
@Component
public class ForecastApiClient {

    private final RestClient restClient;

    public ForecastApiClient(@Qualifier("forecastRestClient") RestClient restClient) {
        this.restClient = restClient;
    }

    public ForecastApiResponse forecast(ForecastApiRequest request) {
        try {
            ForecastApiResponse response = restClient.post()
                    .uri("/forecast")
                    .body(request)
                    .retrieve()
                    .body(ForecastApiResponse.class);
            return validateResponse(request, response);
        } catch (RestClientException exception) {
            throw new ForecastUnavailableException("Forecast service request failed", exception);
        }
    }

    private ForecastApiResponse validateResponse(
            ForecastApiRequest request,
            ForecastApiResponse response) {
        if (response == null
                || !request.metric().equals(response.metric())
                || request.horizonMinutes() != response.horizonMinutes()
                || response.predictedValue() == null
                || response.modelVersion() == null
                || response.modelVersion().isBlank()
                || response.confidenceIntervalLower() == null
                || response.confidenceIntervalUpper() == null
                || response.confidenceIntervalLower().compareTo(response.predictedValue()) > 0
                || response.confidenceIntervalUpper().compareTo(response.predictedValue()) < 0
                || response.timestamp() == null) {
            throw new ForecastUnavailableException("Forecast service returned an invalid contract");
        }
        return response;
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ForecastApiRequest(
            String metric,
            int horizonMinutes,
            BigDecimal currentValue,
            ForecastContext context) {

        public static ForecastApiRequest wbgt(
                int horizonMinutes,
                BigDecimal currentValue,
                ForecastContext context) {
            return new ForecastApiRequest("wbgt", horizonMinutes, currentValue, context);
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ForecastContext(
            String stationId,
            BigDecimal latitude,
            BigDecimal longitude,
            List<ForecastObservation> observations) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ForecastObservation(
            Instant observedAt,
            BigDecimal wbgt,
            BigDecimal airTemperature,
            BigDecimal relativeHumidity,
            BigDecimal windSpeed,
            BigDecimal windDirection,
            BigDecimal rainfall) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ForecastApiResponse(
            String metric,
            BigDecimal predictedValue,
            int horizonMinutes,
            String modelVersion,
            BigDecimal confidenceIntervalLower,
            BigDecimal confidenceIntervalUpper,
            Instant timestamp) {
    }
}
