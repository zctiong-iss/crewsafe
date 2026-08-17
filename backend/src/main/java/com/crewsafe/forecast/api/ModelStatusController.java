package com.crewsafe.forecast.api;

import com.crewsafe.forecast.service.ModelCardService;
import com.crewsafe.forecast.service.ModelCardService.ModelCard;
import com.crewsafe.forecast.service.ModelStatusService;
import com.crewsafe.forecast.service.ModelStatusService.ModelStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Manager-facing view of the deployed WBGT model: approval status and accuracy
 * (SCRUM-150), plus explainability and calibration (SCRUM-152). Not site-scoped:
 * the model is a single global artifact, unlike {@link ForecastController}'s
 * per-site forecasts.
 */
@RestController
@RequestMapping("/api/v1/ml")
@RequiredArgsConstructor
public class ModelStatusController {

    private final ModelStatusService modelStatus;
    private final ModelCardService modelCard;

    @GetMapping("/model-status")
    @PreAuthorize("hasRole('SAFETY_MANAGER')")
    public ResponseEntity<ModelStatus> getModelStatus() {
        return ResponseEntity.ok(modelStatus.currentStatus());
    }

    @GetMapping("/model-card")
    @PreAuthorize("hasRole('SAFETY_MANAGER')")
    public ResponseEntity<ModelCard> getModelCard() {
        return ResponseEntity.ok(modelCard.currentCard());
    }
}
