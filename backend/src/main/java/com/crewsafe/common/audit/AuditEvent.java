package com.crewsafe.common.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.Immutable;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * An append-only audit record (FR-04): who did what, to what, and when.
 *
 * There is no setter and no update path. Audit rows are written once and never modified —
 * a record that can be edited is not evidence.
 *
 * {@code actorId} is nullable because a failed login has no authenticated actor but still
 * has to be recorded.
 *
 * @author Jemilin Beulah
 */
@Entity
@Table(name = "audit_event")
@Immutable
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AuditEvent {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "actor_id", updatable = false)
    private UUID actorId;

    @Column(name = "event_type", nullable = false, length = 64, updatable = false)
    private String eventType;

    @Column(name = "target_type", nullable = false, length = 64, updatable = false)
    private String targetType;

    @Column(name = "target_id", nullable = false, updatable = false)
    private UUID targetId;

    @Column(length = 500, updatable = false)
    private String detail;

    @Column(name = "correlation_id", nullable = false, length = 100, updatable = false)
    private String correlationId;

    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;

    public AuditEvent(UUID actorId, String eventType, String targetType, UUID targetId,
                      String correlationId, String detail) {
        this.id = UUID.randomUUID();
        this.actorId = actorId;
        this.eventType = requireText(eventType, "eventType");
        this.targetType = requireText(targetType, "targetType");
        this.targetId = Objects.requireNonNull(targetId, "targetId is required");
        this.correlationId = requireText(correlationId, "correlationId");
        this.detail = detail;
        this.occurredAt = Instant.now();
    }

    private String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
        return value;
    }
}
