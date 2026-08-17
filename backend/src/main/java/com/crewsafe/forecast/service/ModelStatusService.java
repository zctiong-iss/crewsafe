package com.crewsafe.forecast.service;

import com.crewsafe.forecast.client.ModelStatusApiClient;
import com.crewsafe.forecast.client.ModelStatusApiClient.HorizonMetrics;
import com.crewsafe.forecast.client.ModelStatusApiClient.ModelStatusApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Backend-facing view of the deployed WBGT model's approval status and accuracy
 * metrics (SCRUM-150). Global to the deployed model, not scoped to a site — unlike
 * {@link SiteForecastService}, whose {@code basis}/{@code degraded} fields describe a
 * single forecast call's fallback tier, this describes whether the model itself is
 * currently approved for production inference at all.
 */
@Service
@RequiredArgsConstructor
public class ModelStatusService {

    private final ModelStatusApiClient client;

    public ModelStatus currentStatus() {
        ModelStatusApiResponse response = client.modelStatus();
        return new ModelStatus(
                response.modelVersion(),
                response.approvedForInference(),
                response.approvalBlocker(),
                response.horizons().entrySet().stream()
                        .collect(Collectors.toMap(
                                Map.Entry::getKey,
                                entry -> toHorizonMetrics(entry.getValue()))));
    }

    private static HorizonAccuracy toHorizonMetrics(HorizonMetrics metrics) {
        return new HorizonAccuracy(
                metrics.mae(),
                metrics.rmse(),
                metrics.meanBias(),
                metrics.macroF1(),
                metrics.recallAtLeast32(),
                metrics.recallAtLeast33(),
                metrics.maeByActualBand(),
                metrics.confusionMatrix(),
                metrics.sampleCount());
    }

    /** Approval status and per-horizon accuracy, sourced from the model's evaluation artifact. */
    public record ModelStatus(
            String modelVersion,
            boolean approvedForInference,
            String approvalBlocker,
            Map<String, HorizonAccuracy> horizons) {
    }

    public record HorizonAccuracy(
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
