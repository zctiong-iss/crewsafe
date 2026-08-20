package com.crewsafe.common.audit;

import org.springframework.data.repository.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * @author Jemilin Beulah
 */
public interface AuditEventRepository extends Repository<AuditEvent, UUID> {

    <S extends AuditEvent> S save(S event);

    List<AuditEvent> findByEventTypeOrderByOccurredAtDesc(String eventType);

    /** The most recent event of a type against a target — used by the SCRUM-139 close-out summary
     *  to resolve who closed a shift (and when) from the {@code SHIFT_CLOSED} row itself, so the
     *  "closed by" line is the audit trail's answer, not a second field kept beside it. */
    Optional<AuditEvent> findFirstByEventTypeAndTargetIdOrderByOccurredAtDesc(String eventType, UUID targetId);
}
