package com.crewsafe.supervisor.api;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * DTO for initiating a call to supervisor.
 *
 * Worker provides site ID and optional supervisor ID and notes when calling a supervisor.
 */
public record InitiateCallRequest(
    @NotNull(message = "Site ID is required")
    UUID siteId,

    @Size(max = 500, message = "Notes must be 500 characters or less")
    String notes,

    // Optional supervisor ID - if not provided, will be looked up based on site
    // TODO: Implement automatic supervisor lookup when this is null
    UUID supervisorId
) {}
