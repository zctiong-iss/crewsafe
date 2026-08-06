package com.crewsafe.conditions.api;

import com.crewsafe.lightning.api.LightningRiskPayload;

import java.time.Instant;
import java.util.UUID;

/**
 * One site's conditions-screen payload: WBGT reading, lightning stop-work state, and
 * active-shift context, as of {@code asOf}. Any of the three may legitimately be
 * {@code null} — not an error; each half is ingested independently.
 *
 * @author Jemilin Beulah
 */
public record ConditionsSnapshot(UUID siteId, ConditionsPayload conditions,
                                  LightningRiskPayload lightning,
                                  ActiveShiftPayload activeShift, Instant asOf) {
}
