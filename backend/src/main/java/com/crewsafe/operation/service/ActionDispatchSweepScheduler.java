package com.crewsafe.operation.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Runs the SCRUM-317/324 sweep: one scheduled pass over PENDING/ACKNOWLEDGED rows rather
 * than a timer per dispatch, mirroring {@code SiteConditionsStreamService}'s (SCRUM-168)
 * polling design. Late-marking runs before auto-complete each tick so a dispatch that
 * crossed both windows in one sweep ends up LATE-then-COMPLETED, not stuck.
 *
 * @author Jemilin Beulah
 */
@Component
@ConditionalOnProperty(prefix = "app.action-dispatch.sweep", name = "enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class ActionDispatchSweepScheduler {

    private final ActionDispatchService actionDispatchService;

    @Scheduled(
            initialDelayString = "${app.action-dispatch.sweep.initial-delay}",
            fixedDelayString = "${app.action-dispatch.sweep.interval}"
    )
    public void sweep() {
        try {
            int lateCount = actionDispatchService.markLateDispatches();
            int autoCompletedCount = actionDispatchService.autoCompleteDispatches();
            log.info("action_dispatch_sweep_completed: late={}, autoCompleted={}", lateCount, autoCompletedCount);
        } catch (RuntimeException failure) {
            // Same reasoning as WeatherIngestionScheduler: an escaped exception stops every
            // future run, so record the failure and let the next tick retry.
            log.error("action_dispatch_sweep_failed_retry_scheduled");
        }
    }
}
