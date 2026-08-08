package com.crewsafe.policy.service;

import com.crewsafe.policy.domain.AcclimatisationLevel;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;

import static org.assertj.core.api.Assertions.*;

/**
 * Unit tests for AcclimatisationCalculator.
 *
 * Tests cover:
 * - Day boundary calculations (using Singapore timezone)
 * - Acclimatisation level derivation
 * - Edge cases (same day, far future, 365 day cap)
 */
@DisplayName("AcclimatisationCalculator")
class AcclimatisationCalculatorTest {

    private AcclimatisationCalculator calculator;
    private static final ZoneId SG_ZONE = ZoneId.of("Asia/Singapore");

    @BeforeEach
    void setUp() {
        calculator = new AcclimatisationCalculator();
    }

    @Nested
    @DisplayName("Day calculation")
    class DayCalculation {

        @Test
        @DisplayName("Same day assignment → day 1")
        void sameDay() {
            Instant startDate = Instant.parse("2026-08-07T10:00:00Z");
            Instant referenceDate = Instant.parse("2026-08-07T15:00:00Z");

            int day = calculator.calculateAcclimatisationDay(startDate, referenceDate);

            assertThat(day).isEqualTo(1);
        }

        @Test
        @DisplayName("Next day → day 2")
        void nextDay() {
            Instant startDate = Instant.parse("2026-08-07T10:00:00Z");
            Instant referenceDate = Instant.parse("2026-08-08T10:00:00Z");

            int day = calculator.calculateAcclimatisationDay(startDate, referenceDate);

            assertThat(day).isEqualTo(2);
        }

        @Test
        @DisplayName("7 days later → day 7")
        void sevenDaysLater() {
            Instant startDate = Instant.parse("2026-08-07T10:00:00Z");
            Instant referenceDate = Instant.parse("2026-08-14T10:00:00Z");

            int day = calculator.calculateAcclimatisationDay(startDate, referenceDate);

            assertThat(day).isEqualTo(8);
        }

        @Test
        @DisplayName("Day boundary crossing (midnight SG time)")
        void dayBoundaryCrossing() {
            // Start: 2026-08-07 23:59 UTC = 2026-08-08 07:59 SG
            Instant startDate = Instant.parse("2026-08-07T23:59:00Z");
            // Reference: 2026-08-08 00:01 UTC = 2026-08-08 08:01 SG (still same SG day)
            Instant referenceDate = Instant.parse("2026-08-08T00:01:00Z");

            int day = calculator.calculateAcclimatisationDay(startDate, referenceDate);

            // Should be day 1 (same SG date)
            assertThat(day).isEqualTo(1);
        }

        @Test
        @DisplayName("365 days capped at 365")
        void capAt365() {
            Instant startDate = Instant.parse("2026-08-07T10:00:00Z");
            Instant referenceDate = startDate.plus(400, ChronoUnit.DAYS);

            int day = calculator.calculateAcclimatisationDay(startDate, referenceDate);

            assertThat(day).isEqualTo(365);
        }
    }

    @Nested
    @DisplayName("Level derivation")
    class LevelDerivation {

        @Test
        @DisplayName("Day 1-3 → UNACCLIMATISED")
        void unacclimatisedLevel() {
            assertThat(calculator.getLevel(1)).isEqualTo(AcclimatisationLevel.UNACCLIMATISED);
            assertThat(calculator.getLevel(2)).isEqualTo(AcclimatisationLevel.UNACCLIMATISED);
            assertThat(calculator.getLevel(3)).isEqualTo(AcclimatisationLevel.UNACCLIMATISED);
        }

        @Test
        @DisplayName("Day 4-6 → PARTIAL")
        void partialLevel() {
            assertThat(calculator.getLevel(4)).isEqualTo(AcclimatisationLevel.PARTIAL);
            assertThat(calculator.getLevel(5)).isEqualTo(AcclimatisationLevel.PARTIAL);
            assertThat(calculator.getLevel(6)).isEqualTo(AcclimatisationLevel.PARTIAL);
        }

        @Test
        @DisplayName("Day 7+ → FULL")
        void fullLevel() {
            assertThat(calculator.getLevel(7)).isEqualTo(AcclimatisationLevel.FULL);
            assertThat(calculator.getLevel(30)).isEqualTo(AcclimatisationLevel.FULL);
            assertThat(calculator.getLevel(365)).isEqualTo(AcclimatisationLevel.FULL);
        }
    }

    @Nested
    @DisplayName("Acclimatisation phase checks")
    class PhaseChecks {

        @Test
        @DisplayName("Days 1-6 are in acclimatisation phase")
        void isInAcclimatisationPhase() {
            for (int day = 1; day <= 6; day++) {
                assertThat(calculator.isInAcclimatisationPhase(day)).isTrue();
            }
        }

        @Test
        @DisplayName("Days 7+ are not in acclimatisation phase")
        void isNotInAcclimatisationPhase() {
            assertThat(calculator.isInAcclimatisationPhase(7)).isFalse();
            assertThat(calculator.isInAcclimatisationPhase(30)).isFalse();
            assertThat(calculator.isInAcclimatisationPhase(365)).isFalse();
        }

        @Test
        @DisplayName("Days 1-6 are not fully acclimatised")
        void isNotFullyAcclimatised() {
            for (int day = 1; day <= 6; day++) {
                assertThat(calculator.isFullyAcclimatised(day)).isFalse();
            }
        }

        @Test
        @DisplayName("Days 7+ are fully acclimatised")
        void isFullyAcclimatised() {
            assertThat(calculator.isFullyAcclimatised(7)).isTrue();
            assertThat(calculator.isFullyAcclimatised(30)).isTrue();
            assertThat(calculator.isFullyAcclimatised(365)).isTrue();
        }
    }

    @Nested
    @DisplayName("Error handling")
    class ErrorHandling {

        @Test
        @DisplayName("Reference date before assignment → IllegalArgumentException")
        void referenceDateBeforeAssignment() {
            Instant startDate = Instant.parse("2026-08-07T10:00:00Z");
            Instant referenceDate = Instant.parse("2026-08-06T10:00:00Z");

            assertThatThrownBy(() ->
                    calculator.calculateAcclimatisationDay(startDate, referenceDate)
            ).isInstanceOf(IllegalArgumentException.class)
             .hasMessageContaining("Reference date cannot be before");
        }

        @Test
        @DisplayName("Invalid acclimatisation day → IllegalArgumentException")
        void invalidAcclimatisationDay() {
            assertThatThrownBy(() ->
                    calculator.getLevel(0)
            ).isInstanceOf(IllegalArgumentException.class);

            assertThatThrownBy(() ->
                    calculator.getLevel(-1)
            ).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Nested
    @DisplayName("Integration with AcclimatisationLevel enum")
    class IntegrationWithEnum {

        @Test
        @DisplayName("Calculator day → level → enum properties match")
        void calculatorLevelMatch() {
            // Day 2 (unacclimatised)
            var level2 = calculator.getLevel(2);
            assertThat(level2).isEqualTo(AcclimatisationLevel.UNACCLIMATISED);
            assertThat(level2.getMinDay()).isEqualTo(1);
            assertThat(level2.getMaxDay()).isEqualTo(3);

            // Day 5 (partial)
            var level5 = calculator.getLevel(5);
            assertThat(level5).isEqualTo(AcclimatisationLevel.PARTIAL);
            assertThat(level5.getMinDay()).isEqualTo(4);
            assertThat(level5.getMaxDay()).isEqualTo(6);

            // Day 10 (full)
            var level10 = calculator.getLevel(10);
            assertThat(level10).isEqualTo(AcclimatisationLevel.FULL);
        }
    }
}
