package com.crewsafe.shift.summary;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.weather.domain.WbgtBand;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * The SCRUM-139 (US-44) end-of-shift close-out summary: one defensible record of a shift, with
 * every countable total drawn straight from the audit trail.
 *
 * <p><strong>Reconciliation by construction.</strong> {@code eventCountsByType} is the raw
 * {@code GROUP BY event_type} over the shift's effective audit rows, and every named bucket
 * ({@link Actions}, the readiness figure in {@link Conditions}) is derived from that same map by
 * {@link #from}. A total on screen is therefore a {@code COUNT(*)} of the exact rows the audit
 * export would print for this shift — the summary cannot disagree with the trail because it is the
 * trail, re-shaped. {@code totalAuditEvents} is the sum of the map and the anchor a reviewer checks
 * against.
 *
 * @author Tang Chee Seng
 */
public record ShiftCloseSummaryResponse(
        UUID shiftId,
        UUID siteId,
        String siteName,
        Instant startsAt,
        Instant endsAt,
        String status,
        String localRange,
        int workerCount,
        /** When the shift was closed and by whom, read from the SHIFT_CLOSED audit row; both null
         *  when the shift is not yet closed — the summary is still returned so an active shift can
         *  be previewed. */
        Instant closedAt,
        String closedByName,
        Conditions conditions,
        Actions actions,
        long totalAuditEvents,
        Map<String, Long> eventCountsByType) {

    /** Conditions context: the readiness count is audit-derived; the peak band is the shift
     *  window's highest WBGT classified by the statutory thresholds, or null when no reading fell
     *  in the window (see {@link WbgtBand#classify}). */
    public record Conditions(int readinessSubmissions, BigDecimal peakWbgt, WbgtBand peakBand) {
    }

    /** The four action totals a supervisor must be able to defend, each a sum of specific audit
     *  event types — the single place the type→bucket mapping lives. */
    public record Actions(int issued, int acknowledged, int completed, int exceptions) {

        /**
         * Derives the buckets from the raw per-type counts. A dispatch is "issued" whether a
         * supervisor sent it or the auto-dispatch path did; a completion counts the worker's tap
         * and the sweep's auto-complete alike; an exception is a missed (late) action or a worker
         * raising a concern — the two "this shift didn't run clean" facts. An auto-complete is the
         * system closing the loop, deliberately not an exception.
         */
        public static Actions from(Map<String, Long> counts) {
            return new Actions(
                    sum(counts, AuditEventType.ACTION_DISPATCHED, AuditEventType.ACTION_AUTO_DISPATCHED),
                    sum(counts, AuditEventType.ACTION_ACKNOWLEDGED),
                    sum(counts, AuditEventType.ACTION_COMPLETED, AuditEventType.ACTION_AUTO_COMPLETED),
                    sum(counts, AuditEventType.ACTION_LATE, AuditEventType.CONCERN_RAISED));
        }

        private static int sum(Map<String, Long> counts, String... eventTypes) {
            long total = 0;
            for (String type : eventTypes) {
                total += counts.getOrDefault(type, 0L);
            }
            return Math.toIntExact(total);
        }
    }
}
