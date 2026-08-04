package com.crewsafe.common.audit;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.repository.AppUserRepository;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Proves the audit trail remains append-only outside normal application code paths. */
class AuditEventAppendOnlyTest extends AbstractIntegrationTest {

    @Autowired
    private AuditService audit;

    @Autowired
    private AuditEventRepository events;

    @Autowired
    private AppUserRepository users;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void storesTheRequiredEvidenceAndRejectsDatabaseUpdateAndDelete() {
        String suffix = UUID.randomUUID().toString();
        AppUser actor = users.save(new AppUser(
                "audit-" + suffix, suffix, "Audit Test User", Role.ADMIN));
        String eventType = "SCRUM_183_TEST";
        String correlationId = UUID.randomUUID().toString();

        MDC.put("requestId", correlationId);
        try {
            audit.record(actor.getId(), eventType, "USER", actor.getId(), "original detail");
        } finally {
            MDC.remove("requestId");
        }

        AuditEvent stored = events.findByEventTypeOrderByOccurredAtDesc(eventType).stream()
                .filter(event -> event.getActorId().equals(actor.getId()))
                .findFirst()
                .orElseThrow();

        assertThat(stored.getActorId()).isEqualTo(actor.getId());
        assertThat(stored.getEventType()).isEqualTo(eventType);
        assertThat(stored.getTargetType()).isEqualTo("USER");
        assertThat(stored.getTargetId()).isEqualTo(actor.getId());
        assertThat(stored.getCorrelationId()).isEqualTo(correlationId);
        assertThat(stored.getOccurredAt()).isNotNull();

        assertThatThrownBy(() -> jdbc.update(
                "UPDATE audit_event SET detail = ? WHERE id = ?", "tampered", stored.getId()))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("audit_event is append-only: UPDATE is forbidden");
        assertThatThrownBy(() -> jdbc.update(
                "DELETE FROM audit_event WHERE id = ?", stored.getId()))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("audit_event is append-only: DELETE is forbidden");

        assertThat(jdbc.queryForObject(
                "SELECT detail FROM audit_event WHERE id = ?", String.class, stored.getId()))
                .isEqualTo("original detail");
    }

    @Test
    void repositoryDoesNotExposeRemovalMethods() {
        assertThat(Arrays.stream(AuditEventRepository.class.getMethods())
                .map(Method::getName))
                .noneMatch(name -> name.startsWith("delete"));
    }

    @Test
    void createsAUsefulCorrelationIdOutsideAnHttpRequest() {
        String suffix = UUID.randomUUID().toString();
        AppUser actor = users.save(new AppUser(
                "background-audit-" + suffix, suffix, "Background Audit User", Role.ADMIN));
        String eventType = "BACKGROUND_AUDIT_TEST";

        MDC.remove("requestId");
        audit.record(actor.getId(), eventType, "USER", actor.getId(), "background event");

        AuditEvent stored = events.findByEventTypeOrderByOccurredAtDesc(eventType).stream()
                .filter(event -> event.getActorId().equals(actor.getId()))
                .findFirst()
                .orElseThrow();

        assertThatCode(() -> UUID.fromString(stored.getCorrelationId()))
                .doesNotThrowAnyException();
    }
}
