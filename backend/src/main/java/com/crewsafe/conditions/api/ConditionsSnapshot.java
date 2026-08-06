package com.crewsafe.conditions.api;

import java.time.Instant;
import java.util.UUID;

/**
 * One site's conditions-screen payload: WBGT reading plus active-shift context, as of
 * {@code asOf}. Either half may legitimately be {@code null} — not an error.
 *
 * @author Jemilin Beulah
 */
public record ConditionsSnapshot(UUID siteId, ConditionsPayload conditions,
                                  ActiveShiftPayload activeShift, Instant asOf) {
}
