package com.crewsafe.shift.domain;

/**
 * Mirrors the {@code shift_assignment_intensity_chk} CHECK constraint in
 * {@code V3__domain_schema.sql} and {@code Intensity} in {@code docs/api/shift.yaml}
 * exactly.
 *
 * Fixed set only, never free text: this drives the heat-rest policy engine downstream,
 * so it is required on every assignment request rather than defaulted, even though the
 * database column itself defaults to {@link #MODERATE}.
 *
 * @author Abu Bakar
 */
public enum Intensity {
    LIGHT, MODERATE, HEAVY
}
