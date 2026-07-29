package com.crewsafe.common.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
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
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AuditEvent {

    @Id
    private UUID id;

    @Column(name = "actor_id")
    private UUID actorId;

    @Column(name = "event_type", nullable = false, length = 64)
    private String eventType;

    @Column(name = "target_type", length = 64)
    private String targetType;

    @Column(name = "target_id")
    private UUID targetId;

    @Column(length = 500)
    private String detail;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    public AuditEvent(UUID actorId, String eventType, String targetType, UUID targetId, String detail) {
        this.id = UUID.randomUUID();
        this.actorId = actorId;
        this.eventType = eventType;
        this.targetType = targetType;
        this.targetId = targetId;
        this.detail = detail;
    }

    @PrePersist
    void onCreate() {
        if (occurredAt == null) {
            occurredAt = Instant.now();
        }
    }
}
