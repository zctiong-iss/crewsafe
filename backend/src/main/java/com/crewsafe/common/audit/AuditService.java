package com.crewsafe.common.audit;

import com.crewsafe.common.web.RequestIdFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Writes audit events (FR-04).
 *
 * Every method uses {@code REQUIRES_NEW} so the audit record commits independently of the
 * operation being audited. A failed login has no surrounding transaction to join, and a
 * denied request must leave a trace even when the work it attempted is rolled back —
 * evidence that disappears with the failure is not evidence.
 *
 * @author Jemilin Beulah
 */
@Service
@RequiredArgsConstructor
public class AuditService {

    private final AuditEventRepository events;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(UUID actorId, String eventType, String targetType, UUID targetId, String detail) {
        save(actorId, eventType, targetType, targetId, detail);
    }

    private void save(UUID actorId, String eventType, String targetType, UUID targetId, String detail) {
        events.save(new AuditEvent(actorId, eventType, targetType, targetId,
                RequestIdFilter.current(), truncate(detail)));
    }

    /** The detail column is VARCHAR(500); an over-long value must not fail the write. */
    private String truncate(String detail) {
        if (detail == null || detail.length() <= 500) {
            return detail;
        }
        return detail.substring(0, 500);
    }
}
