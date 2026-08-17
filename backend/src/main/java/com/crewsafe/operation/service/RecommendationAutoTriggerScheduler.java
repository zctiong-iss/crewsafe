package com.crewsafe.operation.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Runs the SCRUM-291 auto-trigger evaluation at the configured cadence, after weather/lightning
 * ingestion have had a chance to run. Same shape as {@code WeatherIngestionScheduler}/
 * {@code LightningIngestionScheduler}/{@code ActionDispatchSweepScheduler}: single-purpose, own
 * interval property, escaped exceptions are caught and logged rather than left to kill future
 * runs.
 *
 * @author Abu Bakar
 */
@Component
@ConditionalOnProperty(prefix = "app.recommendation.auto-trigger", name = "enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class RecommendationAutoTriggerScheduler {

    private final RecommendationAutoTriggerService autoTriggerService;

    @Scheduled(
            initialDelayString = "${app.recommendation.auto-trigger.initial-delay}",
            fixedDelayString = "${app.recommendation.auto-trigger.interval}"
    )
    public void evaluate() {
        try {
            int triggeredCount = autoTriggerService.evaluateAllSites();
            if (triggeredCount > 0) {
                log.info("recommendation_auto_trigger_completed: triggered={}", triggeredCount);
            }
        } catch (RuntimeException failure) {
            // Same reasoning as WeatherIngestionScheduler: an escaped exception stops every
            // future run, so record the failure and let the next tick retry.
            log.error("recommendation_auto_trigger_failed_retry_scheduled", failure);
        }
    }
}
