package com.crewsafe.operation.api;

import java.time.Instant;
import java.util.UUID;

/**
 * Per-site dispatch counts by status, computed from the same shift-scoped dispatch list a
 * client's {@code action-status} events came from (SCRUM-317/324) -- so the badge count
 * never has to be summed client-side. {@code completed} is this shift's count, not all-time.
 *
 * @author Jemilin Beulah
 */
public record AlertCountResponse(UUID siteId, long pending, long late, long acknowledged,
                                  long completed, Instant asOf) {
}
