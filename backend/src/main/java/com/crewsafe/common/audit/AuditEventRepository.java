package com.crewsafe.common.audit;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * @author Jemilin Beulah
 */
public interface AuditEventRepository extends JpaRepository<AuditEvent, UUID> {

    List<AuditEvent> findByEventTypeOrderByOccurredAtDesc(String eventType);
}
