package com.crewsafe.supervisor.api;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * DTO for initiating a call to supervisor.
 *
 * Worker provides site ID and optional notes when calling a supervisor.
 */
public record InitiateCallRequest(
    @NotNull(message = "Site ID is required")
    UUID siteId,

    @Size(max = 500, message = "Notes must be 500 characters or less")
    String notes
) {}
