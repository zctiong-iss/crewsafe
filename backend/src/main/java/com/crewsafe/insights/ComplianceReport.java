package com.crewsafe.insights;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The SCRUM-433 compliance & response-time report for one site over {@code [from, to)}, matching
 * the web {@code ComplianceReport} contract exactly.
 *
 * <p>Counts are the resolved-outcome view of dispatched actions: {@code actedOn} (a person
 * acknowledged or completed) and {@code lapsed} (the sweep stepped in — LATE or a SYSTEM
 * auto-complete) always sum to {@code dispatched}. Still-PENDING dispatches are unresolved and
 * excluded, so the rate is never diluted by actions that simply have not been answered yet.
 *
 * @author Tang Chee Seng
 */
public record ComplianceReport(
        UUID siteId,
        Instant from,
        Instant to,
        int dispatched,
        int actedOn,
        int lapsed,
        double complianceRate,
        /** Null when no action in range was acknowledged (no response times to summarise). */
        Double p50ResponseSeconds,
        Double p95ResponseSeconds,
        List<ComplianceBucket> compliance,
        List<ResponseTimeBucket> responseTimes) {

    /** One bar of the compliance chart: a day and how its dispatched actions resolved. */
    public record ComplianceBucket(String label, int dispatched, int actedOn, int lapsed) {
    }

    /** One bar of the response-time histogram: a latency band and how many acks fell in it. */
    public record ResponseTimeBucket(String label, int count) {
    }
}
