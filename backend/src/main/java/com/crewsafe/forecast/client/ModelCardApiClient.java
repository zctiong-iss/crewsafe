package com.crewsafe.forecast.client;

import com.crewsafe.forecast.service.ForecastUnavailableException;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.List;
import java.util.Map;

/**
 * Typed boundary to the private FastAPI model-card contract (SCRUM-152):
 * SHAP driver importance, confidence-interval calibration, and per-band error.
 *
 * <p>Separate from {@link ModelStatusApiClient} even though both read the same
 * manifest server-side — approval status and explainability are different
 * concerns with different consumers, matching how the two Jira stories
 * (SCRUM-150/SCRUM-152) are scoped separately.
 */
@Component
public class ModelCardApiClient {

    private final RestClient restClient;

    public ModelCardApiClient(@Qualifier("forecastRestClient") RestClient restClient) {
        this.restClient = restClient;
    }

    public ModelCardApiResponse modelCard() {
        try {
            ModelCardApiResponse response = restClient.get()
                    .uri("/model/card")
                    .retrieve()
                    .body(ModelCardApiResponse.class);
            return validateResponse(response);
        } catch (RestClientException exception) {
            throw new ForecastUnavailableException("Model card service request failed", exception);
        }
    }

    private ModelCardApiResponse validateResponse(ModelCardApiResponse response) {
        if (response == null
                || response.modelVersion() == null
                || response.modelVersion().isBlank()
                || response.horizons() == null) {
            throw new ForecastUnavailableException("Model card service returned an invalid contract");
        }
        return response;
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ModelCardApiResponse(
            String modelVersion,
            Map<String, HorizonCard> horizons) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record HorizonCard(
            List<ShapDriver> shapDrivers,
            boolean shapComputed,
            Calibration calibration,
            Map<String, Double> maeByActualBand) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ShapDriver(
            String feature,
            double meanAbsShap) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record Calibration(
            double targetCoverage,
            double finalTestCoverage,
            int calibrationSampleCount) {
    }
}
