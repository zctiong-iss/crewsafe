package com.crewsafe.identity.api;

import java.util.List;
import java.util.UUID;

/**
 * The current user. A response DTO exists precisely so that entity fields are never
 * exposed by accident.
 */
public record MeResponse(
        UUID id,
        String username,
        String displayName,
        String role,
        List<UUID> siteIds) {
}
