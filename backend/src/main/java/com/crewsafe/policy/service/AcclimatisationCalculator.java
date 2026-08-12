package com.crewsafe.policy.service;

import com.crewsafe.policy.domain.AcclimatisationLevel;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * Helper service for calculating worker acclimatisation level.
 *
 * Acclimatisation is measured in days from start of shift assignment.
 * Day 1 = first day at site, Day 7+ = fully acclimatised.
 *
 * This is a stateless utility service.
 */
@Service
@Slf4j
public class AcclimatisationCalculator {

    private static final ZoneId SINGAPORE_ZONE = ZoneId.of("Asia/Singapore");

    /**
     * Calculate acclimatisation day from assignment start date.
     *
     * @param assignmentStartDate when worker was assigned to this site (instant in UTC)
     * @param referenceDate date to calculate from (typically today)
     * @return acclimatisation day (1-based, clamped to 365 max)
     * @throws IllegalArgumentException if referenceDate is before assignmentStartDate
     */
    public int calculateAcclimatisationDay(Instant assignmentStartDate, Instant referenceDate) {
        if (referenceDate.isBefore(assignmentStartDate)) {
            throw new IllegalArgumentException(
                    "Reference date cannot be before assignment start date"
            );
        }

        // Convert to Singapore local date for day boundary calculation
        LocalDate startDate = assignmentStartDate.atZone(SINGAPORE_ZONE).toLocalDate();
        LocalDate refDate = referenceDate.atZone(SINGAPORE_ZONE).toLocalDate();

        // Calculate days elapsed (0-indexed) and convert to 1-indexed day
        long daysElapsed = java.time.temporal.ChronoUnit.DAYS.between(startDate, refDate);
        int acclimatisationDay = (int) Math.min(daysElapsed + 1, 365);

        log.debug("acclimatisation_calculation_completed day={}", acclimatisationDay);

        return acclimatisationDay;
    }

    /**
     * Get acclimatisation level for given day.
     *
     * @param acclimatisationDay 1-based day count
     * @return AcclimatisationLevel
     */
    public AcclimatisationLevel getLevel(int acclimatisationDay) {
        return AcclimatisationLevel.fromDay(acclimatisationDay);
    }

    /**
     * Check if worker is fully acclimatised.
     *
     * @param acclimatisationDay 1-based day count
     * @return true if day >= 7
     */
    public boolean isFullyAcclimatised(int acclimatisationDay) {
        return acclimatisationDay >= 7;
    }

    /**
     * Check if worker is in acclimatisation phase.
     *
     * @param acclimatisationDay 1-based day count
     * @return true if day < 7
     */
    public boolean isInAcclimatisationPhase(int acclimatisationDay) {
        return acclimatisationDay < 7;
    }
}
