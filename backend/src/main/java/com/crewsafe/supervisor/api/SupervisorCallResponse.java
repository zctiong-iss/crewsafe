package com.crewsafe.supervisor.api;

import com.crewsafe.supervisor.domain.SupervisorCallSession;

import java.time.ZonedDateTime;
import java.util.UUID;

/**
 * DTO for SupervisorCallSession response.
 *
 * Returned by API endpoints to represent call session state.
 */
public record SupervisorCallResponse(
    UUID id,
    UUID siteId,
    UUID workerId,
    UUID supervisorId,
    String status,
    ZonedDateTime initiatedAt,
    ZonedDateTime acceptedAt,
    ZonedDateTime endedAt,
    Integer callDurationSeconds,
    String notes
) {
    /**
     * Convert a domain entity to a response DTO.
     */
    public static SupervisorCallResponse from(SupervisorCallSession session) {
        return new SupervisorCallResponse(
            session.getId(),
            session.getSiteId(),
            session.getWorkerId(),
            session.getSupervisorId(),
            session.getStatus().toString(),
            session.getInitiatedAt(),
            session.getAcceptedAt(),
            session.getEndedAt(),
            session.getCallDurationSeconds(),
            session.getNotes()
        );
    }
}
