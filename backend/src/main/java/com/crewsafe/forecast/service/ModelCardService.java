package com.crewsafe.forecast.service;

import com.crewsafe.forecast.client.ModelCardApiClient;
import com.crewsafe.forecast.client.ModelCardApiClient.HorizonCard;
import com.crewsafe.forecast.client.ModelCardApiClient.ModelCardApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Backend-facing explainability and reliability view of the deployed WBGT
 * model (SCRUM-152): SHAP driver importance, confidence-interval calibration,
 * and per-risk-band error. Global to the deployed model, not site-scoped —
 * same reasoning as {@link ModelStatusService}.
 */
@Service
@RequiredArgsConstructor
public class ModelCardService {

    private final ModelCardApiClient client;

    public ModelCard currentCard() {
        ModelCardApiResponse response = client.modelCard();
        return new ModelCard(
                response.modelVersion(),
                response.horizons().entrySet().stream()
                        .collect(Collectors.toMap(
                                Map.Entry::getKey,
                                entry -> toHorizonCard(entry.getValue()))));
    }

    private static ModelCardHorizon toHorizonCard(HorizonCard card) {
        return new ModelCardHorizon(
                card.shapDrivers().stream()
                        .map(driver -> new ShapDriver(driver.feature(), driver.meanAbsShap()))
                        .toList(),
                card.shapComputed(),
                card.calibration() == null
                        ? null
                        : new Calibration(
                                card.calibration().targetCoverage(),
                                card.calibration().finalTestCoverage(),
                                card.calibration().calibrationSampleCount()),
                card.maeByActualBand());
    }

    /** Explainability and reliability data for the configured model, per horizon. */
    public record ModelCard(
            String modelVersion,
            Map<String, ModelCardHorizon> horizons) {
    }

    public record ModelCardHorizon(
            List<ShapDriver> shapDrivers,
            boolean shapComputed,
            Calibration calibration,
            Map<String, Double> maeByActualBand) {
    }

    public record ShapDriver(
            String feature,
            double meanAbsShap) {
    }

    public record Calibration(
            double targetCoverage,
            double finalTestCoverage,
            int calibrationSampleCount) {
    }
}
