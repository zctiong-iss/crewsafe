package com.crewsafe.conditions.api;

import java.time.Instant;
import java.util.UUID;

/** The active-shift half of a {@link ConditionsSnapshot}. Crew-roster detail lives on the shift screens, not here. */
public record ActiveShiftPayload(UUID shiftId, Instant startsAt, Instant endsAt) {
}
