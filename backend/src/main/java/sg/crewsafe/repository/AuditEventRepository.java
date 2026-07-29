package sg.crewsafe.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import sg.crewsafe.entity.AuditEvent;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Repository
public interface AuditEventRepository extends JpaRepository<AuditEvent, UUID> {
    List<AuditEvent> findByTargetIdAndEventTypeOrderByOccurredAt(UUID targetId, String eventType);
    List<AuditEvent> findByActorIdOrderByOccurredAtDesc(UUID actorId);
    List<AuditEvent> findByOccurredAtBetweenOrderByOccurredAtDesc(LocalDateTime start, LocalDateTime end);
}
