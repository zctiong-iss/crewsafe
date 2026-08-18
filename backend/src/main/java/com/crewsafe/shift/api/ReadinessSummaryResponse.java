package com.crewsafe.shift.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The SCRUM-437 supervisor readiness summary: every upcoming shift at a site, and for each,
 * how much of its roster has cleared the pre-shift readiness check.
 *
 * <p>The classification ({@code SUBMITTED} / {@code STALE} / {@code MISSING}) is decided
 * server-side and shipped as a value, because "stale" is a freshness policy judgement — how
 * old a submission may be before it no longer counts. The web renders the verdict; it never
 * re-derives it, so the policy lives in exactly one place (see
 * {@link com.crewsafe.shift.service.ReadinessSummaryService}).
 *
 * @author Tang Chee Seng
 */
public record ReadinessSummaryResponse(UUID siteId, List<ShiftReadiness> shifts) {

    /** How one worker on a shift stands against the readiness check. */
    public record WorkerReadiness(
            UUID workerId,
            String displayName,
            ReadinessStatus status,
            /** Null when MISSING — there is no submission to read fitness from. */
            Boolean fitToWork,
            /** Null when MISSING. */
            Instant submittedAt,
            /** True when the latest submission carried any symptom other than NONE. */
            boolean flaggedSymptom) {
    }

    /** One upcoming shift and its roster's readiness, with the three counts pre-tallied. */
    public record ShiftReadiness(
            UUID shiftId,
            Instant startsAt,
            Instant endsAt,
            String status,
            int submitted,
            int stale,
            int missing,
            List<WorkerReadiness> workers) {
    }

    /**
     * Server-classified readiness verdict for a rostered worker.
     *
     * <ul>
     *   <li>{@code SUBMITTED} — a submission exists and is within the freshness window.</li>
     *   <li>{@code STALE} — a submission exists but predates the freshness window.</li>
     *   <li>{@code MISSING} — the worker is rostered but has never submitted for this shift.</li>
     * </ul>
     */
    public enum ReadinessStatus {
        SUBMITTED,
        STALE,
        MISSING
    }
}
