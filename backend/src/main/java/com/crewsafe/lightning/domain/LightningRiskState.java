package com.crewsafe.lightning.domain;

/**
 * A site's lightning hazard state (FR-10a / SCRUM-170), derived from recent strike
 * proximity rather than stored directly.
 *
 * @author Jemilin Beulah
 */
public enum LightningRiskState {
    CLEAR,
    ADVISORY,
    STOP_WORK
}
