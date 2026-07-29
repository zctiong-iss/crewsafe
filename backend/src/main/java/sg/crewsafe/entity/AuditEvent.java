package sg.crewsafe.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "audit_events")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AuditEvent {
    @Id
    private UUID id = UUID.randomUUID();

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "actor_id")
    private User actor;

    private String eventType; // SHIFT_CREATED, RECOMMENDATION_GENERATED, APPROVAL_GIVEN, etc.

    private String targetType; // Shift, Recommendation, User, etc.

    private UUID targetId;

    @Lob
    private String details; // JSON with full context

    private LocalDateTime occurredAt;

    @PrePersist
    protected void onCreate() {
        if (occurredAt == null) occurredAt = LocalDateTime.now();
    }
}
