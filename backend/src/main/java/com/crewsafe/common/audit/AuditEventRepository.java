package com.crewsafe.common.audit;

import org.springframework.data.repository.Repository;

import java.util.List;
import java.util.UUID;

/**
 * @author Jemilin Beulah
 */
public interface AuditEventRepository extends Repository<AuditEvent, UUID> {

    <S extends AuditEvent> S save(S event);

    List<AuditEvent> findByEventTypeOrderByOccurredAtDesc(String eventType);
}
