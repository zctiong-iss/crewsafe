package com.crewsafe.supervisor.api;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * DTO for initiating a call to supervisor.
 *
 * Worker provides site ID, supervisor ID and optional notes when calling a supervisor.
 * Automatic site-and-schedule lookup remains a future capability outside this change; until
 * then, callers must identify the supervisor explicitly.
 */
public record InitiateCallRequest(
    @NotNull(message = "Site ID is required")
    UUID siteId,

    @Size(max = 500, message = "Notes must be 500 characters or less")
    String notes,

    @NotNull(message = "Supervisor ID is required")
    UUID supervisorId
) {}
