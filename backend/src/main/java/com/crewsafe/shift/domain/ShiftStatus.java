package com.crewsafe.shift.domain;

/**
 * Mirrors the {@code shift_status_chk} CHECK constraint in {@code V3__domain_schema.sql}
 * and {@code ShiftStatus} in {@code docs/api/shift.yaml} exactly.
 *
 * Server-controlled only: a client cannot set this at creation, every shift is created
 * {@link #PLANNED}. No transition endpoints exist yet (SCRUM-160 scope).
 *
 * @author Abu Bakar
 */
public enum ShiftStatus {
    PLANNED, ACTIVE, CLOSED
}
