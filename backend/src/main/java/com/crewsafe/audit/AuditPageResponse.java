package com.crewsafe.audit;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A page of the SCRUM-435 audit timeline, matching the web {@code AuditPage} contract exactly.
 * Offset paging (page + pageSize + total) keeps the first cut simple; the inspector reads a
 * bounded window, not an infinite scroll.
 *
 * @author Tang Chee Seng
 */
public record AuditPageResponse(
        UUID siteId,
        Instant from,
        Instant to,
        int page,
        int pageSize,
        long totalEntries,
        List<AuditEntryResponse> entries) {

    /** One assembled timeline row — every field already inspector-readable (server-resolved). */
    public record AuditEntryResponse(
            Instant occurredAt,
            String actorName,
            String eventLabel,
            String eventType,
            String targetType,
            UUID targetId,
            String correlationId,
            String detail) {

        /** Resolves the actor name ("system / unauthenticated" when none) and the human label. */
        static AuditEntryResponse from(AuditRowView row) {
            String actor = row.getActorName() != null ? row.getActorName() : "system / unauthenticated";
            return new AuditEntryResponse(
                    row.getOccurredAt(), actor, AuditEventLabels.labelFor(row.getEventType()),
                    row.getEventType(), row.getTargetType(), row.getTargetId(),
                    row.getCorrelationId(), row.getDetail());
        }
    }
}
