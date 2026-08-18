package com.crewsafe.audit;

import java.time.Instant;
import java.util.UUID;

/**
 * One assembled audit row as the SCRUM-435 export reads it: the raw event plus the actor's
 * resolved display name. A Spring Data interface projection — the native query's column
 * aliases match these getters, so no entity or hand-written mapper stands in between.
 *
 * @author Tang Chee Seng
 */
public interface AuditRowView {
    Instant getOccurredAt();

    UUID getActorId();

    /** Null when the event had no authenticated actor (e.g. a system sweep or a failed login). */
    String getActorName();

    String getEventType();

    String getTargetType();

    UUID getTargetId();

    String getCorrelationId();

    String getDetail();
}
