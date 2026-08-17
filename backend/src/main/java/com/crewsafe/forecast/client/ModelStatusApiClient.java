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
 * Typed boundary to the private FastAPI model-status contract (SCRUM-150).
 *
 * <p>Separate from {@link ForecastApiClient} on purpose: the two calls share only the
 * underlying HTTP client, not a request/response shape, and {@code /forecast} is a
 * hot per-prediction path while this is an infrequent dashboard read.
 */
@Component
public class ModelStatusApiClient {

    private final RestClient restClient;

    public ModelStatusApiClient(@Qualifier("forecastRestClient") RestClient restClient) {
        this.restClient = restClient;
    }

    public ModelStatusApiResponse modelStatus() {
        try {
            ModelStatusApiResponse response = restClient.get()
                    .uri("/model/status")
                    .retrieve()
                    .body(ModelStatusApiResponse.class);
            return validateResponse(response);
        } catch (RestClientException exception) {
            throw new ForecastUnavailableException("Model status service request failed", exception);
        }
    }

    private ModelStatusApiResponse validateResponse(ModelStatusApiResponse response) {
        if (response == null
                || response.modelVersion() == null
                || response.modelVersion().isBlank()
                || response.horizons() == null) {
            throw new ForecastUnavailableException("Model status service returned an invalid contract");
        }
        return response;
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ModelStatusApiResponse(
            String modelVersion,
            boolean approvedForInference,
            String approvalBlocker,
            Map<String, HorizonMetrics> horizons) {
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record HorizonMetrics(
            double mae,
            double rmse,
            double meanBias,
            double macroF1,
            double recallAtLeast32,
            double recallAtLeast33,
            Map<String, Double> maeByActualBand,
            List<List<Integer>> confusionMatrix,
            int sampleCount) {
    }
}
