package com.crewsafe.shift.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Runs the SCRUM-441 activation sweep at the configured cadence: flips PLANNED shifts to
 * ACTIVE once their start time passes, so {@code ConditionsSnapshotService} and
 * {@code ActionStatusSnapshotService} — both queried by ACTIVE status — stop reading as
 * permanently empty. Same shape as {@code WeatherIngestionScheduler}/
 * {@code LightningIngestionScheduler}/{@code ActionDispatchSweepScheduler}: single-purpose,
 * own interval property, escaped exceptions are caught and logged rather than left to kill
 * future runs.
 *
 * @author Abu Bakar
 */
@Component
@ConditionalOnProperty(prefix = "app.shift.activation", name = "enabled", havingValue = "true")
@RequiredArgsConstructor
@Slf4j
public class ShiftActivationScheduler {

    private final ShiftService shiftService;

    @Scheduled(
            initialDelayString = "${app.shift.activation.initial-delay}",
            fixedDelayString = "${app.shift.activation.interval}"
    )
    public void activate() {
        try {
            int activatedCount = shiftService.activateDueShifts();
            if (activatedCount > 0) {
                log.info("shifts_auto_activated: count={}", activatedCount);
            }
        } catch (RuntimeException failure) {
            // Same reasoning as WeatherIngestionScheduler: an escaped exception stops every
            // future run, so record the failure and let the next tick retry.
            log.error("shift_activation_sweep_failed_retry_scheduled", failure);
        }
    }
}
