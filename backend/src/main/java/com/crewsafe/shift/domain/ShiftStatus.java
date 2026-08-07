package com.crewsafe.shift.domain;

/**
 * Mirrors the {@code shift_status_chk} CHECK constraint in {@code V3__domain_schema.sql}
 * (widened by {@code V8__shift_cancelled_status.sql}) and {@code ShiftStatus} in
 * {@code docs/api/shift.yaml} exactly.
 *
 * Server-controlled only: a client cannot set this at creation, every shift is created
 * {@link #PLANNED}. The only transition endpoint is cancel (SCRUM-255) — see
 * {@link com.crewsafe.shift.service.ShiftService#cancelShift} for which statuses may
 * become {@link #CANCELLED}; there is no un-cancel path, and no other status is
 * settable via the API at all.
 *
 * @author Abu Bakar
 */
public enum ShiftStatus {
    PLANNED, ACTIVE, CLOSED,

    /**
     * A shift that was called off rather than run — kept as a record (audit/history),
     * unlike {@code DELETE /shifts/{shiftId}} which removes the row outright. Terminal:
     * once cancelled, a shift stays cancelled.
     */
    CANCELLED
}
